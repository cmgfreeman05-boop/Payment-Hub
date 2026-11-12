import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, mutationHeaders, registerUser, TEST_ORIGIN } from './helpers.js';

let context: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(async () => { await context?.close(); context = undefined; });

describe('checkout and billing', () => {
  it('uses server catalog pricing and validates checkout input', async () => {
    context = await createTestContext();
    const { body } = await context.agent.get('/api/plans').expect(200);
    expect(body.plans).toHaveLength(5);
    expect(body.plans[0]).not.toHaveProperty('stripePriceId');
    const auth = await registerUser(context.agent);
    await context.agent.post('/api/checkout/sessions').set(mutationHeaders(auth.csrfToken)).send({ planId: 'essential-report' }).expect(422);
    await context.agent.post('/api/checkout/sessions').set(mutationHeaders(auth.csrfToken)).set('Idempotency-Key', randomUUID()).send({ planId: 'unknown' }).expect(422);
    await context.agent.post('/api/checkout/sessions').set('Origin', TEST_ORIGIN).set('Idempotency-Key', randomUUID()).send({ planId: 'essential-report' }).expect(403);
  });

  it('replays idempotent checkout and rejects key reuse for another plan', async () => {
    context = await createTestContext();
    const auth = await registerUser(context.agent);
    const key = randomUUID();
    const first = await context.agent.post('/api/checkout/sessions').set(mutationHeaders(auth.csrfToken)).set('Idempotency-Key', key).send({ planId: 'essential-report' }).expect(201);
    const replay = await context.agent.post('/api/checkout/sessions').set(mutationHeaders(auth.csrfToken)).set('Idempotency-Key', key).send({ planId: 'essential-report' }).expect(200);
    expect(replay.body.orderId).toBe(first.body.orderId);
    expect(replay.body.url).toBe(first.body.url);
    const orders = await context.agent.get('/api/orders').expect(200);
    expect(orders.body.orders).toHaveLength(1);
    expect(orders.body.orders[0].amountCents).toBe(2900);
    await context.agent.post('/api/checkout/sessions').set(mutationHeaders(auth.csrfToken)).set('Idempotency-Key', key).send({ planId: 'portfolio-pack' }).expect(409);
  });

  it('enforces order ownership and completes the explicit demo payment flow', async () => {
    context = await createTestContext();
    const auth = await registerUser(context.agent);
    const checkout = await context.agent.post('/api/checkout/sessions').set(mutationHeaders(auth.csrfToken)).set('Idempotency-Key', randomUUID()).send({ planId: 'essential-report' }).expect(201);
    const intruder = await registerUser(context.agent, 'intruder@example.com');
    await context.agent.get(`/api/orders/${checkout.body.orderId}`).expect(404);
    const login = await context.agent.post('/api/auth/login').set('Origin', TEST_ORIGIN).send({ email: 'customer@example.com', password: 'correct-horse-battery-staple' }).expect(200);
    const completed = await context.agent.post(`/api/demo/checkout/${checkout.body.orderId}/complete`).set(mutationHeaders(login.body.csrfToken)).expect(200);
    expect(completed.body.order.status).toBe('paid');
    await context.agent.post(`/api/demo/checkout/${checkout.body.orderId}/complete`).set(mutationHeaders(login.body.csrfToken)).expect(200);
    const orders = await context.agent.get('/api/orders').expect(200);
    expect(orders.body.orders).toHaveLength(1);
    expect(orders.body.orders[0].status).toBe('paid');
    const portal = await context.agent.post('/api/billing/portal').set(mutationHeaders(login.body.csrfToken)).expect(200);
    expect(portal.body.url).toContain('demo_portal=1');
    expect(intruder.user.id).not.toBe(auth.user.id);
  });

  it('activates and cancels a demo subscription through event processing', async () => {
    context = await createTestContext();
    const auth = await registerUser(context.agent);
    const checkout = await context.agent.post('/api/checkout/sessions').set(mutationHeaders(auth.csrfToken)).set('Idempotency-Key', randomUUID()).send({ planId: 'pro-monthly' }).expect(201);
    await context.agent.post(`/api/demo/checkout/${checkout.body.orderId}/complete`).set(mutationHeaders(auth.csrfToken)).expect(200);
    const active = await context.agent.get('/api/subscriptions').expect(200);
    expect(active.body.subscriptions).toHaveLength(1);
    expect(active.body.subscriptions[0].status).toBe('active');
    await context.agent.post(`/api/demo/subscriptions/${active.body.subscriptions[0].id}/cancel`).set(mutationHeaders(auth.csrfToken)).expect(200);
    const canceled = await context.agent.get('/api/subscriptions').expect(200);
    expect(canceled.body.subscriptions[0].status).toBe('canceled');
  });

  it('refuses billing portal before a customer exists', async () => {
    context = await createTestContext();
    const auth = await registerUser(context.agent);
    const response = await context.agent.post('/api/billing/portal').set(mutationHeaders(auth.csrfToken)).expect(409);
    expect(response.body.error.code).toBe('NO_BILLING_ACCOUNT');
  });
});