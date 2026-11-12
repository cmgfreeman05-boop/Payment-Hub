import supertest from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/index.js';
import { seedCatalog } from '../src/db/seed.js';
import { createLogger } from '../src/logger.js';
import { DemoPaymentGateway, StripePaymentGateway, type PaymentGateway } from '../src/stripe/gateway.js';

export const TEST_ORIGIN = 'http://localhost:5173';
export const TEST_PASSWORD = 'correct-horse-battery-staple';
export const WEBHOOK_SECRET = 'whsec_test_secret_for_automated_tests';

export async function createTestContext(mode: 'demo' | 'stripe' = 'demo') {
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_URL: TEST_ORIGIN,
    DATABASE_DRIVER: 'pglite',
    PGLITE_DATA_DIR: ':memory:',
    SESSION_SECRET: 'test-session-secret-that-is-long-enough-123456',
    PAYMENT_GATEWAY: mode,
    LOG_LEVEL: 'silent',
    ...(mode === 'stripe' ? { STRIPE_SECRET_KEY: 'sk_test_automated_placeholder', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET } : {}),
  });
  const connection = await createDatabase(config);
  await connection.migrate();
  await seedCatalog(connection.db);
  const gateway: PaymentGateway = mode === 'demo' ? new DemoPaymentGateway(config.appUrl) : new StripePaymentGateway(config.stripeSecretKey!, config.stripeWebhookSecret!);
  const logger = createLogger(config);
  const app = createApp({ config, db: connection.db, gateway, logger });
  const agent = supertest.agent(app);
  return {
    config,
    db: connection.db,
    gateway,
    app,
    agent,
    close: () => connection.close(),
  };
}

export async function registerUser(agent: ReturnType<typeof supertest.agent>, email = 'customer@example.com') {
  const response = await agent.post('/api/auth/register').set('Origin', TEST_ORIGIN).send({ email, password: TEST_PASSWORD }).expect(201);
  return response.body as { user: { id: string; email: string }; csrfToken: string };
}

export function mutationHeaders(csrfToken: string) {
  return { Origin: TEST_ORIGIN, 'X-CSRF-Token': csrfToken };
}