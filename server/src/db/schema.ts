import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

export const paymentKind = pgEnum('payment_kind', ['one_time', 'subscription']);
export const billingInterval = pgEnum('billing_interval', ['month', 'year']);
export const orderStatus = pgEnum('order_status', ['pending', 'paid', 'failed', 'expired', 'partially_refunded', 'refunded']);
export const subscriptionStatus = pgEnum('subscription_status', ['active', 'trialing', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 254 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  stripeCustomerId: text('stripe_customer_id').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index('sessions_user_idx').on(table.userId)]);

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  kind: paymentKind('kind').notNull(),
  amountCents: integer('amount_cents').notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  interval: billingInterval('interval'),
  features: jsonb('features').$type<string[]>().notNull(),
  active: boolean('active').default(true).notNull(),
  stripePriceId: text('stripe_price_id').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  planId: text('plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
  idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  stripeCheckoutSessionId: text('stripe_checkout_session_id').unique(),
  stripePaymentIntentId: text('stripe_payment_intent_id').unique(),
  amountCents: integer('amount_cents').notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  status: orderStatus('status').default('pending').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('orders_user_idempotency_idx').on(table.userId, table.idempotencyKey),
  index('orders_user_created_idx').on(table.userId, table.createdAt),
  index('orders_status_created_idx').on(table.status, table.createdAt),
]);

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  planId: text('plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
  stripeSubscriptionId: text('stripe_subscription_id').notNull().unique(),
  stripeCustomerId: text('stripe_customer_id').notNull(),
  status: subscriptionStatus('status').notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index('subscriptions_user_idx').on(table.userId)]);

export const stripeEvents = pgTable('stripe_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow().notNull(),
});