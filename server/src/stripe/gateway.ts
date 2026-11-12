import Stripe from 'stripe';
import type { CatalogPlan } from '../catalog.js';
import { AppError } from '../errors.js';

export type CheckoutPlan = CatalogPlan & { stripePriceId?: string | null };

export type CreateCheckoutInput = {
  orderId: string;
  userId: string;
  plan: CheckoutPlan;
  priceId: string;
  customerId: string;
  successUrl: string;
  cancelUrl: string;
};

export interface PaymentGateway {
  readonly mode: 'stripe' | 'demo';
  ensureCustomer(userId: string, email: string): Promise<string>;
  ensurePrice(plan: CheckoutPlan): Promise<string>;
  createCheckoutSession(input: CreateCheckoutInput): Promise<Stripe.Checkout.Session>;
  retrieveCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session>;
  retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription>;
  createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
  constructEvent(payload: Buffer, signature: string): Stripe.Event;
}

export function stripeId(value: string | { id: string } | null | undefined): string | null {
  if (typeof value === 'string') return value;
  return value?.id ?? null;
}

export function subscriptionPeriodEnd(subscription: Stripe.Subscription): Date | null {
  const periodEnd = subscription.items.data[0]?.current_period_end;
  return typeof periodEnd === 'number' ? new Date(periodEnd * 1000) : null;
}

export class StripePaymentGateway implements PaymentGateway {
  readonly mode = 'stripe' as const;
  private readonly stripe: Stripe;

  constructor(secretKey: string, private readonly webhookSecret: string) {
    this.stripe = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 20_000 });
  }

  async ensureCustomer(userId: string, email: string): Promise<string> {
    const customer = await this.stripe.customers.create({ email, metadata: { userId } }, { idempotencyKey: `customer:${userId}` });
    return customer.id;
  }

  async ensurePrice(plan: CheckoutPlan): Promise<string> {
    if (plan.stripePriceId) return plan.stripePriceId;
    const existing = await this.stripe.prices.list({ active: true, lookup_keys: [plan.id], limit: 1 });
    const match = existing.data.find((price) => priceMatchesPlan(price, plan));
    if (match) return match.id;

    const product = await this.stripe.products.create(
      { name: plan.name, description: plan.description, metadata: { planId: plan.id } },
      { idempotencyKey: `product:${plan.id}:${plan.amountCents}` },
    );
    const recurring = plan.kind === 'subscription' ? { interval: subscriptionInterval(plan) } : undefined;
    const price = await this.stripe.prices.create({
      product: product.id,
      unit_amount: plan.amountCents,
      currency: plan.currency,
      lookup_key: plan.id,
      transfer_lookup_key: true,
      nickname: plan.name,
      ...(recurring ? { recurring } : {}),
    }, { idempotencyKey: `price:${plan.id}:${plan.amountCents}:${plan.interval ?? 'one_time'}` });
    return price.id;
  }

  async createCheckoutSession(input: CreateCheckoutInput): Promise<Stripe.Checkout.Session> {
    const metadata = { orderId: input.orderId, userId: input.userId, planId: input.plan.id };
    const mode = input.plan.kind === 'subscription' ? 'subscription' : 'payment';
    return this.stripe.checkout.sessions.create({
      mode,
      customer: input.customerId,
      client_reference_id: input.userId,
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata,
      ...(mode === 'subscription' ? { subscription_data: { metadata } } : { payment_intent_data: { metadata } }),
    }, { idempotencyKey: `checkout:${input.orderId}` });
  }

  retrieveCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
    return this.stripe.checkout.sessions.retrieve(sessionId);
  }

  retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.retrieve(subscriptionId);
  }

  async createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    return { url: session.url };
  }

  constructEvent(payload: Buffer, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);
  }
}

function subscriptionInterval(plan: CheckoutPlan): 'month' | 'year' {
  if (plan.interval !== 'month' && plan.interval !== 'year') throw new AppError(500, 'INVALID_PLAN', 'The subscription plan has no billing interval.');
  return plan.interval;
}

function priceMatchesPlan(price: Stripe.Price, plan: CheckoutPlan): boolean {
  return price.unit_amount === plan.amountCents
    && price.currency === plan.currency
    && (plan.kind === 'one_time' ? price.type === 'one_time' : price.type === 'recurring' && price.recurring?.interval === plan.interval);
}

type DemoOrder = { id: string; userId: string; amountCents: number; currency: string };

export class DemoPaymentGateway implements PaymentGateway {
  readonly mode = 'demo' as const;
  private readonly sessions = new Map<string, Stripe.Checkout.Session>();
  private readonly subscriptions = new Map<string, Stripe.Subscription>();
  private readonly events = new Map<string, Stripe.Event[]>();

  constructor(private readonly appUrl: string) {}

  async ensureCustomer(userId: string): Promise<string> {
    return `demo_cus_${userId}`;
  }

  async ensurePrice(plan: CheckoutPlan): Promise<string> {
    return `demo_price_${plan.id}`;
  }

  async createCheckoutSession(input: CreateCheckoutInput): Promise<Stripe.Checkout.Session> {
    const session = {
      id: `demo_cs_${input.orderId}`,
      object: 'checkout.session',
      status: 'open',
      payment_status: 'unpaid',
      mode: input.plan.kind === 'subscription' ? 'subscription' : 'payment',
      url: `${this.appUrl}/?demo_checkout=${input.orderId}`,
      customer: input.customerId,
      metadata: { orderId: input.orderId, userId: input.userId, planId: input.plan.id },
      amount_total: input.plan.amountCents,
      currency: input.plan.currency,
      payment_intent: null,
      subscription: null,
    } as unknown as Stripe.Checkout.Session;
    this.sessions.set(input.orderId, session);
    return session;
  }

  async retrieveCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
    const session = [...this.sessions.values()].find((candidate) => candidate.id === sessionId);
    if (!session) throw new AppError(404, 'CHECKOUT_NOT_FOUND', 'The demo checkout session was not found.');
    return session;
  }

  async retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) throw new AppError(404, 'SUBSCRIPTION_NOT_FOUND', 'The demo subscription was not found.');
    return subscription;
  }

  async createPortalSession(): Promise<{ url: string }> {
    return { url: `${this.appUrl}/?demo_portal=1` };
  }

  constructEvent(): Stripe.Event {
    throw new AppError(503, 'WEBHOOK_DISABLED', 'Stripe webhooks are disabled while the explicit demo gateway is active.');
  }

  completeCheckout(order: DemoOrder, plan: CheckoutPlan): Stripe.Event[] {
    const existingEvents = this.events.get(order.id);
    if (existingEvents) return existingEvents;
    const session = this.sessions.get(order.id);
    if (!session) throw new AppError(404, 'CHECKOUT_NOT_FOUND', 'Start a checkout before completing a demo payment.');
    session.status = 'complete';
    session.payment_status = 'paid';
    session.payment_intent = `demo_pi_${order.id}`;
    if (plan.kind === 'subscription') {
      const subscriptionId = `demo_sub_${order.id}`;
      session.subscription = subscriptionId;
      const intervalSeconds = plan.interval === 'year' ? 365 * 24 * 60 * 60 : 30 * 24 * 60 * 60;
      this.subscriptions.set(subscriptionId, {
        id: subscriptionId,
        object: 'subscription',
        customer: `demo_cus_${order.userId}`,
        status: 'active',
        cancel_at_period_end: false,
        metadata: { userId: order.userId, planId: plan.id, orderId: order.id },
        items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + intervalSeconds }] },
      } as unknown as Stripe.Subscription);
    }
    const events = [this.event(`demo_evt_${order.id}_completed`, 'checkout.session.completed', session)];
    this.events.set(order.id, events);
    return events;
  }

  cancelSubscription(subscriptionId: string): Stripe.Event[] {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) throw new AppError(404, 'SUBSCRIPTION_NOT_FOUND', 'The demo subscription was not found.');
    subscription.status = 'canceled';
    subscription.cancel_at_period_end = false;
    return [this.event(`demo_evt_${subscriptionId}_deleted`, 'customer.subscription.deleted', subscription)];
  }

  private event(id: string, type: string, object: unknown): Stripe.Event {
    return {
      id,
      object: 'event',
      api_version: 'demo',
      created: Math.floor(Date.now() / 1000),
      data: { object },
      livemode: false,
      pending_webhooks: 0,
      request: null,
      type,
    } as unknown as Stripe.Event;
  }
}