import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const productionEnv = {
  NODE_ENV: 'production',
  APP_URL: 'https://payments.example.com',
  DATABASE_DRIVER: 'postgres',
  DATABASE_URL: 'postgresql://payments:secret@db.example.com:5432/payments',
  SESSION_SECRET: 'production-session-secret-that-is-long-enough',
  PAYMENT_GATEWAY: 'stripe',
  STRIPE_SECRET_KEY: 'sk_test_placeholder',
  STRIPE_WEBHOOK_SECRET: 'whsec_placeholder',
};

describe('configuration boundary', () => {
  it('fails closed for unsafe production settings', () => {
    expect(() => loadConfig({ ...productionEnv, PAYMENT_GATEWAY: 'demo' })).toThrow('must be stripe');
    expect(() => loadConfig({ ...productionEnv, DATABASE_DRIVER: 'pglite', DATABASE_URL: '' })).toThrow('PostgreSQL');
    expect(() => loadConfig({ ...productionEnv, SESSION_SECRET: '' })).toThrow('SESSION_SECRET');
    expect(() => loadConfig({ ...productionEnv, APP_URL: 'http://payments.example.com' })).toThrow('HTTPS');
    expect(() => loadConfig({ ...productionEnv, STRIPE_WEBHOOK_SECRET: '' })).toThrow('STRIPE_WEBHOOK_SECRET');
  });

  it('accepts a complete production configuration', () => {
    const config = loadConfig(productionEnv);
    expect(config.databaseDriver).toBe('postgres');
    expect(config.paymentGateway).toBe('stripe');
  });

  it('requires credentials for Stripe outside production and permits explicit demo mode', () => {
    expect(() => loadConfig({ NODE_ENV: 'development', PAYMENT_GATEWAY: 'stripe' })).toThrow('Stripe mode requires');
    expect(loadConfig({ NODE_ENV: 'development', PAYMENT_GATEWAY: 'demo' }).paymentGateway).toBe('demo');
  });

  it('infers PostgreSQL when DATABASE_URL is supplied', () => {
    const config = loadConfig({ NODE_ENV: 'development', PAYMENT_GATEWAY: 'demo', DATABASE_URL: 'postgresql://localhost/payments' });
    expect(config.databaseDriver).toBe('postgres');
  });
});