export type GatewayMode = 'stripe' | 'demo';

export type AppConfig = {
  gateway: GatewayMode;
  stripeConfigured: boolean;
};

export type User = {
  id: string;
  email: string;
  createdAt: string;
  hasBillingAccount: boolean;
};

export type AuthResponse = {
  user: User;
  csrfToken: string;
};

export type Plan = {
  id: string;
  name: string;
  description: string;
  kind: 'one_time' | 'subscription';
  amountCents: number;
  currency: string;
  interval: 'month' | 'year' | null;
  features: string[];
  active: boolean;
};

export type OrderStatus = 'pending' | 'paid' | 'failed' | 'expired' | 'partially_refunded' | 'refunded';

export type Order = {
  id: string;
  planId: string;
  planName: string;
  amountCents: number;
  currency: string;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
};

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'unpaid' | 'paused';

export type Subscription = {
  id: string;
  planId: string;
  planName: string;
  status: SubscriptionStatus;
  amountCents: number;
  currency: string;
  interval: 'month' | 'year' | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CheckoutResponse = {
  created: boolean;
  orderId: string;
  url: string | null;
  status: string;
  gateway: GatewayMode;
};