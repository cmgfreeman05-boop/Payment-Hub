import { loadConfig } from '../config.js';
import { createDatabase } from '../db/index.js';
import { createLogger } from '../logger.js';
import { reconcilePendingOrders } from '../services/webhooks.js';
import { DemoPaymentGateway, StripePaymentGateway } from '../stripe/gateway.js';

const config = loadConfig();
const logger = createLogger(config);
const connection = await createDatabase(config);
try {
  const gateway = config.paymentGateway === 'demo'
    ? new DemoPaymentGateway(config.appUrl)
    : new StripePaymentGateway(config.stripeSecretKey!, config.stripeWebhookSecret!);
  const reconciled = await reconcilePendingOrders(connection.db, gateway);
  logger.info({ reconciled }, 'Pending order reconciliation completed');
} finally {
  await connection.close();
}