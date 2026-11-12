import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { orders, plans, stripeEvents } from '../src/db/schema.js';
import { reconcilePendingOrders } from '../src/services/webhooks.js';
import { createTestContext, registerUser, WEBHOOK_SECRET } from './helpers.js';

let context: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(async () => { await context?.close(); context = undefined; vi.restoreAllMocks(); });

const stripe = new Stripe('sk_test_automated_placeholder');

async function seedOrder(userId: string, planId = 'essential-report') {
  if (!context) throw new Error('Missing test context');
  const [plan] = await context.db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!plan) throw new Error('Missing plan');
  const [order] = await context.db.insert(orders).values({
    userId,
    planId,
    idempotencyKey: randomUUID(),
    requestHash: 'test',
    stripeCheckoutSessionId: `cs_test_${randomUUID()}`,
    amountCents: plan.amountCents,
    currency: plan.currency,
  }).returning();
  if (!order) throw new Error('Missing order');
  return { order, plan };
}

function paymentEvent(order: typeof orders.$inferSelect, sessionId: string, overrides: Record<string, unknown> = {}): Stripe.Event {
  return {
    id: `evt_${randomUUID()}`,
    object: 'event',
    api_version: 'test',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        mode: 'payment',
        payment_status: 'paid',
        amount_total: order.amountCents,
        currency: order.currency,
        payment_intent: `pi_${randomUUID()}`,
        metadata: { orderId: order.id, userId: order.userId, planId: order.planId },
        ...overrides,
      },
    },
  } as unknown as Stripe.Event;
}

function sendWebhook(event: Stripe.Event, secret = WEBHOOK_SECRET) {
  if (!context) throw new Error('Missing test context');
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return context.agent.post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', signature).send(payload);
}

describe('Stripe webhooks', () => {
  it('rejects invalid signatures and deduplicates valid events transactionally', async () => {
    context = await createTestContext('stripe');
    const auth = await registerUser(context.agent);
    const { order } = await seedOrder(auth.user.id);
    const event = paymentEvent(order, order.stripeCheckoutSessionId!);
    const payload = JSON.stringify(event);
    await context.agent.post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', 'invalid').send(payload).expect(400);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    const first = await context.agent.post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', signature).send(payload).expect(200);
    expect(first.body.duplicate).toBe(false);
    const replay = await context.agent.post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', signature).send(payload).expect(200);
    expect(replay.body.duplicate).toBe(true);
    const [updated] = await context.db.select().from(orders).where(eq(orders.id, order.id));
    expect(updated?.status).toBe('paid');
    expect(await context.db.select().from(stripeEvents)).toHaveLength(1);
  });

  it('rolls back mismatched amounts so Stripe can retry safely', async () => {
    context = await createTestContext('stripe');
    const auth = await registerUser(context.agent);
    const { order } = await seedOrder(auth.user.id);
    await sendWebhook(paymentEvent(order, order.stripeCheckoutSessionId!, { amount_total: 1 })).expect(400);
    const [unchanged] = await context.db.select().from(orders).where(eq(orders.id, order.id));
    expect(unchanged?.status).toBe('pending');
    expect(await context.db.select().from(stripeEvents)).toHaveLength(0);
  });

  it('synchronizes subscription state from the current provider snapshot', async () => {
    context = await createTestContext('stripe');
    const auth = await registerUser(context.agent);
    const subscriptionId = `sub_${randomUUID()}`;
    const snapshot = {
      id: subscriptionId,
      object: 'subscription',
      customer: 'cus_test',
      status: 'active',
      cancel_at_period_end: false,
      metadata: { userId: auth.user.id, planId: 'pro-monthly' },
      items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 86_400 }] },
    } as unknown as Stripe.Subscription;
    const retrieve = vi.spyOn(context.gateway, 'retrieveSubscription').mockResolvedValue(snapshot);
    const updatedEvent = { id: `evt_${randomUUID()}`, object: 'event', type: 'customer.subscription.updated', created: 1, data: { object: { id: subscriptionId } } } as unknown as Stripe.Event;
    await sendWebhook(updatedEvent).expect(200);
    let rows = await context.agent.get('/api/subscriptions').expect(200);
    expect(rows.body.subscriptions[0].status).toBe('active');
    retrieve.mockResolvedValue({ ...snapshot, status: 'past_due' } as Stripe.Subscription);
    await sendWebhook({ ...updatedEvent, id: `evt_${randomUUID()}`, type: 'invoice.payment_failed', data: { object: { id: subscriptionId, parent: { subscription_details: { subscription: subscriptionId } } } } } as unknown as Stripe.Event).expect(200);
    rows = await context.agent.get('/api/subscriptions').expect(200);
    expect(rows.body.subscriptions[0].status).toBe('past_due');
    retrieve.mockResolvedValue({ ...snapshot, status: 'canceled' } as Stripe.Subscription);
    await sendWebhook({ ...updatedEvent, id: `evt_${randomUUID()}`, type: 'customer.subscription.deleted' } as Stripe.Event).expect(200);
    rows = await context.agent.get('/api/subscriptions').expect(200);
    expect(rows.body.subscriptions[0].status).toBe('canceled');
  });

  it('fulfills subscription checkout and initial invoice events without trusting redirects', async () => {
    context = await createTestContext('stripe');
    const auth = await registerUser(context.agent);
    const { order } = await seedOrder(auth.user.id, 'pro-monthly');
    const subscriptionId = `sub_${randomUUID()}`;
    const snapshot = {
      id: subscriptionId,
      object: 'subscription',
      customer: 'cus_test',
      status: 'active',
      cancel_at_period_end: false,
      metadata: { userId: auth.user.id, planId: order.planId, orderId: order.id },
      items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 86_400 }] },
    } as unknown as Stripe.Subscription;
    vi.spyOn(context.gateway, 'retrieveSubscription').mockResolvedValue(snapshot);
    const checkoutEvent = paymentEvent(order, order.stripeCheckoutSessionId!, { mode: 'subscription', subscription: subscriptionId, payment_intent: null });
    await sendWebhook(checkoutEvent).expect(200);
    const [paidOrder] = await context.db.select().from(orders).where(eq(orders.id, order.id));
    expect(paidOrder?.status).toBe('paid');
    const subscriptionRows = await context.agent.get('/api/subscriptions').expect(200);
    expect(subscriptionRows.body.subscriptions[0].status).toBe('active');
  });

  it('records refunds and reconciles stale pending checkouts from Stripe', async () => {
    context = await createTestContext('stripe');
    const auth = await registerUser(context.agent);
    const { order } = await seedOrder(auth.user.id);
    const event = paymentEvent(order, order.stripeCheckoutSessionId!);
    await sendWebhook(event).expect(200);
    const session = event.data.object as Stripe.Checkout.Session;
    const refund = { id: `evt_${randomUUID()}`, object: 'event', type: 'charge.refunded', data: { object: { payment_intent: session.payment_intent, refunded: true } } } as unknown as Stripe.Event;
    await sendWebhook(refund).expect(200);
    const [refunded] = await context.db.select().from(orders).where(eq(orders.id, order.id));
    expect(refunded?.status).toBe('refunded');

    const stale = await seedOrder(auth.user.id);
    await context.db.update(orders).set({ createdAt: new Date(Date.now() - 60 * 60_000) }).where(eq(orders.id, stale.order.id));
    vi.spyOn(context.gateway, 'retrieveCheckoutSession').mockResolvedValue({ ...session, id: stale.order.stripeCheckoutSessionId!, payment_intent: `pi_${randomUUID()}`, metadata: { orderId: stale.order.id, userId: auth.user.id, planId: stale.order.planId } } as Stripe.Checkout.Session);
    expect(await reconcilePendingOrders(context.db, context.gateway)).toBe(1);
    const [reconciled] = await context.db.select().from(orders).where(eq(orders.id, stale.order.id));
    expect(reconciled?.status).toBe('paid');
  });
});