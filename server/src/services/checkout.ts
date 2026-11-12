import { createHash } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/index.js';
import { orders, plans, subscriptions, users } from '../db/schema.js';
import { AppError } from '../errors.js';
import type { AuthenticatedUser } from '../types/express.js';
import type { PaymentGateway } from '../stripe/gateway.js';

type OrderRecord = typeof orders.$inferSelect;

export async function createCheckout(
  db: Database,
  gateway: PaymentGateway,
  config: Pick<AppConfig, 'appUrl'>,
  user: AuthenticatedUser,
  planId: string,
  idempotencyKey: string,
) {
  const requestHash = createHash('sha256').update(planId).digest('hex');
  const [plan] = await db.select().from(plans).where(and(eq(plans.id, planId), eq(plans.active, true))).limit(1);
  if (!plan) throw new AppError(422, 'UNKNOWN_PLAN', 'The selected plan is unavailable.');

  const existing = await findIdempotentOrder(db, user.id, idempotencyKey);
  if (existing) {
    assertSameRequest(existing, requestHash);
    if (existing.stripeCheckoutSessionId) return resolveExistingOrder(db, gateway, existing);
    return continueCheckout(db, gateway, config, user, plan, existing, false);
  }

  const [reserved] = await db.insert(orders).values({
    userId: user.id,
    planId: plan.id,
    idempotencyKey,
    requestHash,
    amountCents: plan.amountCents,
    currency: plan.currency,
  }).onConflictDoNothing().returning();
  if (!reserved) {
    const concurrent = await findIdempotentOrder(db, user.id, idempotencyKey);
    if (!concurrent) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Retry the request with the same idempotency key.');
    assertSameRequest(concurrent, requestHash);
    if (concurrent.stripeCheckoutSessionId) return resolveExistingOrder(db, gateway, concurrent);
    return continueCheckout(db, gateway, config, user, plan, concurrent, false);
  }
  return continueCheckout(db, gateway, config, user, plan, reserved, true);
}

async function findIdempotentOrder(db: Database, userId: string, idempotencyKey: string): Promise<OrderRecord | undefined> {
  const [order] = await db.select().from(orders).where(and(eq(orders.userId, userId), eq(orders.idempotencyKey, idempotencyKey))).limit(1);
  return order;
}

function assertSameRequest(order: OrderRecord, requestHash: string): void {
  if (order.requestHash !== requestHash) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different plan.');
}

async function resolveExistingOrder(db: Database, gateway: PaymentGateway, order: OrderRecord) {
  const sessionId = order.stripeCheckoutSessionId;
  if (!sessionId) throw new AppError(409, 'CHECKOUT_IN_PROGRESS', 'The checkout is still being created.');
  const session = await gateway.retrieveCheckoutSession(sessionId);
  if (session.status === 'open' && session.url) {
    return { created: false, orderId: order.id, url: session.url, status: order.status, gateway: gateway.mode };
  }
  if (session.status === 'expired' && order.status === 'pending') {
    await db.update(orders).set({ status: 'expired', updatedAt: new Date() }).where(and(eq(orders.id, order.id), eq(orders.status, 'pending')));
    throw new AppError(409, 'CHECKOUT_EXPIRED', 'This checkout expired. Start a new checkout.');
  }
  return { created: false, orderId: order.id, url: null, status: order.status, gateway: gateway.mode };
}

async function continueCheckout(
  db: Database,
  gateway: PaymentGateway,
  config: Pick<AppConfig, 'appUrl'>,
  user: AuthenticatedUser,
  plan: typeof plans.$inferSelect,
  order: OrderRecord,
  created: boolean,
) {
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    customerId = await gateway.ensureCustomer(user.id, user.email);
    await db.update(users).set({ stripeCustomerId: customerId }).where(and(eq(users.id, user.id), isNull(users.stripeCustomerId)));
    const [refreshed] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    customerId = refreshed?.stripeCustomerId ?? customerId;
  }

  const priceId = await gateway.ensurePrice(plan);
  if (plan.stripePriceId !== priceId) await db.update(plans).set({ stripePriceId: priceId }).where(eq(plans.id, plan.id));

  const session = await gateway.createCheckoutSession({
    orderId: order.id,
    userId: user.id,
    plan,
    priceId,
    customerId,
    successUrl: `${config.appUrl}/?checkout=success&order=${order.id}`,
    cancelUrl: `${config.appUrl}/?checkout=cancel&order=${order.id}`,
  });
  await db.update(orders).set({ stripeCheckoutSessionId: session.id, updatedAt: new Date() }).where(eq(orders.id, order.id));
  if (!session.url) throw new AppError(502, 'CHECKOUT_URL_UNAVAILABLE', 'Stripe did not return a checkout URL.');
  return { created, orderId: order.id, url: session.url, status: order.status, gateway: gateway.mode };
}

export async function listOrders(db: Database, userId: string) {
  return db.select({
    id: orders.id,
    planId: orders.planId,
    planName: plans.name,
    amountCents: orders.amountCents,
    currency: orders.currency,
    status: orders.status,
    createdAt: orders.createdAt,
    updatedAt: orders.updatedAt,
  }).from(orders).innerJoin(plans, eq(orders.planId, plans.id)).where(eq(orders.userId, userId)).orderBy(desc(orders.createdAt)).limit(100);
}

export async function getOrder(db: Database, userId: string, orderId: string) {
  const [order] = await db.select({
    id: orders.id,
    planId: orders.planId,
    planName: plans.name,
    amountCents: orders.amountCents,
    currency: orders.currency,
    status: orders.status,
    createdAt: orders.createdAt,
    updatedAt: orders.updatedAt,
  }).from(orders).innerJoin(plans, eq(orders.planId, plans.id)).where(and(eq(orders.id, orderId), eq(orders.userId, userId))).limit(1);
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'The order was not found.');
  return order;
}

export async function listSubscriptions(db: Database, userId: string) {
  return db.select({
    id: subscriptions.id,
    planId: subscriptions.planId,
    planName: plans.name,
    status: subscriptions.status,
    amountCents: plans.amountCents,
    currency: plans.currency,
    interval: plans.interval,
    currentPeriodEnd: subscriptions.currentPeriodEnd,
    cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
    createdAt: subscriptions.createdAt,
    updatedAt: subscriptions.updatedAt,
  }).from(subscriptions).innerJoin(plans, eq(subscriptions.planId, plans.id)).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.createdAt));
}

export async function createBillingPortal(gateway: PaymentGateway, config: Pick<AppConfig, 'appUrl'>, user: AuthenticatedUser) {
  if (!user.stripeCustomerId) throw new AppError(409, 'NO_BILLING_ACCOUNT', 'Complete a checkout before opening the billing portal.');
  return gateway.createPortalSession(user.stripeCustomerId, `${config.appUrl}/?billing=returned`);
}