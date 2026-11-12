import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: resolve(rootDir, '.env'), quiet: true });

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_URL: z.url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  DATABASE_DRIVER: z.enum(['pglite', 'postgres']).default('pglite'),
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  PGLITE_DATA_DIR: z.string().min(1).default('.data/pglite'),
  SESSION_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
  PAYMENT_GATEWAY: z.enum(['stripe', 'demo']).default('stripe'),
  STRIPE_SECRET_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  STRIPE_WEBHOOK_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  appUrl: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  trustProxyHops: number;
  databaseDriver: 'pglite' | 'postgres';
  databaseUrl?: string;
  pgliteDataDir: string;
  sessionSecret: string;
  paymentGateway: 'stripe' | 'demo';
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  rootDir: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env, validatePayments = true): AppConfig {
  const parsed = envSchema.safeParse({
    ...env,
    DATABASE_DRIVER: env.DATABASE_DRIVER || (env.DATABASE_URL ? 'postgres' : 'pglite'),
  });
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }
  const value = parsed.data;
  const problems: string[] = [];
  if (value.NODE_ENV === 'production') {
    if (value.PAYMENT_GATEWAY !== 'stripe') problems.push('PAYMENT_GATEWAY must be stripe in production');
    if (value.DATABASE_DRIVER !== 'postgres' || !value.DATABASE_URL) problems.push('PostgreSQL and DATABASE_URL are required in production');
    if (!value.SESSION_SECRET) problems.push('SESSION_SECRET is required in production');
    if (!value.APP_URL.startsWith('https://')) problems.push('APP_URL must use HTTPS in production');
    if (validatePayments && !value.STRIPE_SECRET_KEY?.startsWith('sk_')) problems.push('STRIPE_SECRET_KEY is required in production');
    if (validatePayments && !value.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')) problems.push('STRIPE_WEBHOOK_SECRET is required in production');
  }
  if (validatePayments && value.PAYMENT_GATEWAY === 'stripe' && value.NODE_ENV !== 'production') {
    if (!value.STRIPE_SECRET_KEY?.startsWith('sk_') || !value.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')) {
      problems.push('Stripe mode requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET; use PAYMENT_GATEWAY=demo for local simulation');
    }
  }
  if (value.DATABASE_DRIVER === 'postgres' && !value.DATABASE_URL) problems.push('DATABASE_URL is required for PostgreSQL');
  if (problems.length > 0) throw new Error(`Invalid configuration: ${problems.join('; ')}`);

  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    appUrl: value.APP_URL.replace(/\/$/, ''),
    logLevel: value.LOG_LEVEL,
    trustProxyHops: value.TRUST_PROXY_HOPS,
    databaseDriver: value.DATABASE_DRIVER,
    ...(value.DATABASE_URL ? { databaseUrl: value.DATABASE_URL } : {}),
    pgliteDataDir: value.PGLITE_DATA_DIR === ':memory:' ? ':memory:' : resolve(rootDir, value.PGLITE_DATA_DIR),
    sessionSecret: value.SESSION_SECRET ?? randomBytes(32).toString('hex'),
    paymentGateway: value.PAYMENT_GATEWAY,
    ...(value.STRIPE_SECRET_KEY ? { stripeSecretKey: value.STRIPE_SECRET_KEY } : {}),
    ...(value.STRIPE_WEBHOOK_SECRET ? { stripeWebhookSecret: value.STRIPE_WEBHOOK_SECRET } : {}),
    rootDir,
  };
}