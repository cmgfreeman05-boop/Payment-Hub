import pino from 'pino';
import type { AppConfig } from './config.js';

export function createLogger(config: Pick<AppConfig, 'logLevel' | 'nodeEnv'>) {
  return pino({
    level: config.nodeEnv === 'test' ? 'silent' : config.logLevel,
    redact: {
      paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]', 'password', 'passwordHash', 'stripeSecretKey', 'stripeWebhookSecret'],
      censor: '[REDACTED]',
    },
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = ReturnType<typeof createLogger>;