import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { sql } from 'drizzle-orm';
import type { AppConfig } from './config.js';
import type { Database } from './db/index.js';
import { AppError } from './errors.js';
import type { Logger } from './logger.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { authRouter } from './routes/auth.js';
import { billingRouter } from './routes/billing.js';
import { demoRouter } from './routes/demo.js';
import { processStripeEvent } from './services/webhooks.js';
import type { PaymentGateway } from './stripe/gateway.js';

export type AppDependencies = {
  config: AppConfig;
  db: Database;
  gateway: PaymentGateway;
  logger: Logger;
};

export function createApp({ config, db, gateway, logger }: AppDependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops);
  app.use(pinoHttp({
    logger,
    genReqId: (_req, res) => {
      const id = randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    autoLogging: config.nodeEnv !== 'test',
  }));
  app.use(helmet({
    contentSecurityPolicy: config.nodeEnv === 'production' ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'", 'https://checkout.stripe.com'],
        baseUri: ["'self'"],
      },
    } : false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors({ origin: config.appUrl, credentials: true, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key'] }));
  app.use(compression());

  app.post('/api/webhooks/stripe', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    if (gateway.mode !== 'stripe') throw new AppError(503, 'WEBHOOK_DISABLED', 'Stripe webhooks are disabled while the demo gateway is active.');
    if (!Buffer.isBuffer(req.body)) throw new AppError(400, 'INVALID_WEBHOOK_BODY', 'A raw JSON webhook body is required.');
    const signature = req.get('stripe-signature');
    if (!signature) throw new AppError(400, 'MISSING_SIGNATURE', 'The Stripe signature header is missing.');
    let event;
    try {
      event = gateway.constructEvent(req.body, signature);
    } catch {
      throw new AppError(400, 'INVALID_SIGNATURE', 'The Stripe webhook signature is invalid.');
    }
    const result = await processStripeEvent(db, gateway, event);
    res.json({ received: true, duplicate: result.duplicate });
  });

  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  const limiter = (windowMs: number, limit: number) => rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Try again later.')),
  });
  app.use('/api', limiter(15 * 60_000, 300));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/ready', async (_req, res) => {
    await db.execute(sql`select 1`);
    res.json({ status: 'ready', gateway: gateway.mode });
  });
  app.get('/api/config', (_req, res) => res.json({ gateway: gateway.mode, stripeConfigured: gateway.mode === 'stripe' }));
  app.use('/api/auth', limiter(15 * 60_000, 30), authRouter(db, config));
  app.use('/api', limiter(60 * 60_000, 30), billingRouter(db, gateway, config));
  app.use('/api/demo', demoRouter(db, gateway, config));
  app.use('/api', notFoundHandler());

  const clientDist = resolve(config.rootDir, 'client/dist');
  if (config.nodeEnv === 'production' && existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(clientDist, 'index.html')));
  }
  app.use(errorHandler(logger));
  return app;
}