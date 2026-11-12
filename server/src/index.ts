import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createDatabase } from './db/index.js';
import { createLogger } from './logger.js';
import { DemoPaymentGateway, StripePaymentGateway } from './stripe/gateway.js';

const config = loadConfig();
const logger = createLogger(config);
const connection = await createDatabase(config);
const gateway = config.paymentGateway === 'demo'
  ? new DemoPaymentGateway(config.appUrl)
  : new StripePaymentGateway(config.stripeSecretKey!, config.stripeWebhookSecret!);
const app = createApp({ config, db: connection.db, gateway, logger });
const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info({ port: config.port, gateway: gateway.mode, database: config.databaseDriver }, 'Payment API listening');
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    await connection.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));