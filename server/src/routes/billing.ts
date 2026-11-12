import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/index.js';
import { plans } from '../db/schema.js';
import { requireAuth, requireCsrf, requireOrigin } from '../middleware/auth.js';
import { createBillingPortal, createCheckout, getOrder, listOrders, listSubscriptions } from '../services/checkout.js';
import type { PaymentGateway } from '../stripe/gateway.js';

const checkoutSchema = z.object({ planId: z.string().min(1).max(100) });
const idempotencySchema = z.uuid();
const idSchema = z.uuid();

export function billingRouter(db: Database, gateway: PaymentGateway, config: AppConfig): Router {
  const router = Router();
  const auth = requireAuth(db, config);
  const mutation = [requireOrigin(config), auth, requireCsrf];

  router.get('/plans', async (_req, res) => {
    const rows = await db.select().from(plans).where(eq(plans.active, true)).orderBy(plans.amountCents);
    res.json({ plans: rows.map((plan) => ({ ...plan, stripePriceId: undefined })) });
  });

  router.post('/checkout/sessions', ...mutation, async (req, res) => {
    const { planId } = checkoutSchema.parse(req.body);
    const idempotencyKey = idempotencySchema.parse(req.get('idempotency-key'));
    const result = await createCheckout(db, gateway, config, req.auth!.user, planId, idempotencyKey);
    res.status(result.created ? 201 : 200).json(result);
  });

  router.get('/orders', auth, async (req, res) => {
    res.json({ orders: await listOrders(db, req.auth!.user.id) });
  });

  router.get('/orders/:id', auth, async (req, res) => {
    const id = idSchema.parse(req.params.id);
    res.json({ order: await getOrder(db, req.auth!.user.id, id) });
  });

  router.get('/subscriptions', auth, async (req, res) => {
    res.json({ subscriptions: await listSubscriptions(db, req.auth!.user.id) });
  });

  router.post('/billing/portal', ...mutation, async (req, res) => {
    res.json(await createBillingPortal(gateway, config, req.auth!.user));
  });

  return router;
}