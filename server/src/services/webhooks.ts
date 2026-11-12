import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import type { Database } from '../db/index.js';
import { orders, stripeEvents, subscriptions, type subscriptionStatus } from '../db/schema.js';
import { AppError } from '../errors.js';
import { stripeId, subscriptionPeriodEnd, type PaymentGateway } from '../stripe/gateway.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MUTABLE_ORDER_STATUSES = ['pending', 'failed', 'expired'] as const;
type StoredSubscriptionStatus = typeof subscriptionStatus.enumValues[number];

function normalizeSubscriptionStatus(status: string): StoredSubscriptionStatus {
  switch (status) {
    case 'active':
    case 'trialing':
    case 'past_due':
    case 'canceled':
    case 'incomplete':
    case 'incomplete_expired':
    case 'unpaid':
    case 'paused':
      return status;
    default:
      return 'incomplete';
  }
}

export async function processStripeEvent(db: Database, gateway: PaymentGateway, event: Stripe.Event): Promise<{ duplicate: boolean }> {
  const [alreadyRecorded] = await db.select({ id: stripeEvents.id }).from(stripeEvents).where(eq(stripeEvents.id, event.id)).limit(1);
  if (alreadyRecorded) return { duplicate: true };
  const subscriptionId = eventSubscriptionId(event);
  const snapshot = subscriptionId ? await gateway.retrieveSubscription(subscriptionId) : null;
  return db.transaction(async (tx) => {
    const [recorded] = await tx.insert(stripeEvents).values({
      id: event.id,
      type: event.type,
      payloadHash: createHash('sha256').update(JSON.stringify(event)).digest('hex'),
    }).onConflictDoNothing().returning({ id: stripeEvents.id });
    if (!recorded) return { duplicate: true };

    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        await applyCheckoutEvent(tx, event, snapshot);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'invoice.paid':
      case 'invoice.payment_failed':
        if (snapshot) {
          await upsertSubscription(tx, snapshot);
          if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') await applyInvoiceToOrder(tx, snapshot, event.type);
        }
        break;
      case 'charge.refunded':
        await applyRefund(tx, event.data.object as Stripe.Charge);
        break;
      default:
        break;
    }
    return { duplicate: false };
  });
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

async function applyCheckoutEvent(tx: Transaction, event: Stripe.Event, subscriptionSnapshot: Stripe.Subscription | null): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const orderId = session.metadata?.orderId;
  if (!orderId || !UUID_PATTERN.test(orderId)) return;
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return;
  if (order.stripeCheckoutSessionId && order.stripeCheckoutSessionId !== session.id) throw new AppError(400, 'WEBHOOK_ORDER_MISMATCH', 'The event does not match the stored checkout session.');
  if (session.metadata?.userId !== order.userId) throw new AppError(400, 'WEBHOOK_USER_MISMATCH', 'The event does not match the order owner.');
  if (session.amount_total != null && session.amount_total !== order.amountCents) throw new AppError(400, 'WEBHOOK_AMOUNT_MISMATCH', 'The event amount does not match the order.');
  if (session.currency && session.currency !== order.currency) throw new AppError(400, 'WEBHOOK_CURRENCY_MISMATCH', 'The event currency does not match the order.');

  if (event.type === 'checkout.session.expired') {
    await tx.update(orders).set({ status: 'expired', updatedAt: new Date() }).where(and(eq(orders.id, order.id), eq(orders.status, 'pending')));
    return;
  }
  if (event.type === 'checkout.session.async_payment_failed') {
    await tx.update(orders).set({ status: 'failed', updatedAt: new Date() }).where(and(eq(orders.id, order.id), eq(orders.status, 'pending')));
    return;
  }
  if (session.mode === 'payment' && session.payment_status === 'paid') {
    await tx.update(orders).set({
      status: 'paid',
      stripePaymentIntentId: stripeId(session.payment_intent),
      stripeCheckoutSessionId: session.id,
      updatedAt: new Date(),
    }).where(and(eq(orders.id, order.id), inArray(orders.status, [...MUTABLE_ORDER_STATUSES])));
  }
  if (session.mode === 'subscription' && subscriptionSnapshot) {
    await upsertSubscription(tx, subscriptionSnapshot);
    if (['active', 'trialing'].includes(subscriptionSnapshot.status) && session.payment_status !== 'unpaid') {
      await tx.update(orders).set({ status: 'paid', stripeCheckoutSessionId: session.id, updatedAt: new Date() })
        .where(and(eq(orders.id, order.id), inArray(orders.status, [...MUTABLE_ORDER_STATUSES])));
    }
  }
}

async function upsertSubscription(tx: Transaction, subscription: Stripe.Subscription): Promise<void> {
  const userId = subscription.metadata?.userId;
  const planId = subscription.metadata?.planId;
  const customerId = stripeId(subscription.customer);
  if (!userId || !UUID_PATTERN.test(userId) || !planId || !customerId) throw new AppError(400, 'WEBHOOK_SUBSCRIPTION_METADATA', 'The subscription is missing required ownership metadata.');
  const status = normalizeSubscriptionStatus(subscription.status);
  await tx.insert(subscriptions).values({
    userId,
    planId,
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: customerId,
    status,
    currentPeriodEnd: subscriptionPeriodEnd(subscription),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  }).onConflictDoUpdate({
    target: subscriptions.stripeSubscriptionId,
    set: {
      status,
      currentPeriodEnd: subscriptionPeriodEnd(subscription),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      updatedAt: new Date(),
    },
  });
}

async function applyInvoiceToOrder(tx: Transaction, subscription: Stripe.Subscription, eventType: 'invoice.paid' | 'invoice.payment_failed'): Promise<void> {
  const orderId = subscription.metadata?.orderId;
  if (!orderId || !UUID_PATTERN.test(orderId)) return;
  await tx.update(orders).set({ status: eventType === 'invoice.paid' ? 'paid' : 'failed', updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.userId, subscription.metadata?.userId ?? ''), eq(orders.status, 'pending')));
}

async function applyRefund(tx: Transaction, charge: Stripe.Charge): Promise<void> {
  const paymentIntentId = stripeId(charge.payment_intent);
  if (!paymentIntentId) return;
  await tx.update(orders).set({ status: charge.refunded ? 'refunded' : 'partially_refunded', updatedAt: new Date() })
    .where(and(eq(orders.stripePaymentIntentId, paymentIntentId), inArray(orders.status, ['paid', 'partially_refunded'])));
}

function eventSubscriptionId(event: Stripe.Event): string | null {
  if (event.type.startsWith('customer.subscription.')) return (event.data.object as Stripe.Subscription).id;
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    return session.mode === 'subscription' ? stripeId(session.subscription) : null;
  }
  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as unknown as {
      parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
      subscription?: string | { id: string } | null;
    };
    return stripeId(invoice.parent?.subscription_details?.subscription ?? invoice.subscription);
  }
  return null;
}

export async function reconcilePendingOrders(db: Database, gateway: PaymentGateway, olderThanMinutes = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const pending = await db.select().from(orders).where(and(eq(orders.status, 'pending'), sql`${orders.createdAt} < ${cutoff}`)).limit(100);
  let reconciled = 0;
  for (const order of pending) {
    if (!order.stripeCheckoutSessionId) continue;
    const session = await gateway.retrieveCheckoutSession(order.stripeCheckoutSessionId);
    if (session.status === 'open') continue;
    const type = session.status === 'expired' ? 'checkout.session.expired' : session.payment_status === 'paid' ? 'checkout.session.completed' : null;
    if (!type) continue;
    const event = {
      id: `reconcile_${session.id}_${type}`,
      object: 'event',
      api_version: 'reconciliation',
      created: Math.floor(Date.now() / 1000),
      data: { object: session },
      livemode: false,
      pending_webhooks: 0,
      request: null,
      type,
    } as unknown as Stripe.Event;
    await processStripeEvent(db, gateway, event);
    reconciled += 1;
  }
  return reconciled;
}