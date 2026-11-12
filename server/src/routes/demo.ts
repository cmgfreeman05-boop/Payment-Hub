import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/index.js';
import { orders, plans, subscriptions } from '../db/schema.js';
import { AppError } from '../errors.js';
import { requireAuth, requireCsrf, requireOrigin } from '../middleware/auth.js';
import { processStripeEvent } from '../services/webhooks.js';
import { DemoPaymentGateway, type PaymentGateway } from '../stripe/gateway.js';

export function demoRouter(db: Database, gateway: PaymentGateway, config: AppConfig): Router {
  const router = Router();
  if (config.nodeEnv === 'production' || !(gateway instanceof DemoPaymentGateway)) return router;
  const mutation = [requireOrigin(config), requireAuth(db, config), requireCsrf];
  const idSchema = z.uuid();

  router.post('/checkout/:orderId/complete', ...mutation, async (req, res) => {
    const orderId = idSchema.parse(req.params.orderId);
    const [row] = await db.select({ order: orders, plan: plans }).from(orders).innerJoin(plans, eq(orders.planId, plans.id))
      .where(and(eq(orders.id, orderId), eq(orders.userId, req.auth!.user.id))).limit(1);
    if (!row) throw new AppError(404, 'ORDER_NOT_FOUND', 'The order was not found.');
    for (const event of gateway.completeCheckout(row.order, row.plan)) await processStripeEvent(db, gateway, event);
    const [updated] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    res.json({ order: updated, demo: true });
  });

  router.post('/subscriptions/:subscriptionId/cancel', ...mutation, async (req, res) => {
    const subscriptionId = idSchema.parse(req.params.subscriptionId);
    const [subscription] = await db.select().from(subscriptions)
      .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, req.auth!.user.id))).limit(1);
    if (!subscription) throw new AppError(404, 'SUBSCRIPTION_NOT_FOUND', 'The subscription was not found.');
    for (const event of gateway.cancelSubscription(subscription.stripeSubscriptionId)) await processStripeEvent(db, gateway, event);
    res.json({ canceled: true, demo: true });
  });

  return router;
}