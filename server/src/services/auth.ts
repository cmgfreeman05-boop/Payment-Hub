import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import type { Response } from 'express';
import { and, eq, gt } from 'drizzle-orm';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/index.js';
import { sessions, users } from '../db/schema.js';
import type { AuthenticatedUser } from '../types/express.js';

export const SESSION_COOKIE = 'payment_hub_session';
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const passwordOptions = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, passwordOptions);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function csrfTokenForSession(sessionId: string, secret: string): string {
  return createHmac('sha256', secret).update(`csrf:${sessionId}`).digest('hex');
}

export function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function createSession(db: Database, userId: string, config: Pick<AppConfig, 'sessionSecret'>) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);
  const [session] = await db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt }).returning();
  if (!session) throw new Error('Session creation failed');
  return { token, sessionId: session.id, csrfToken: csrfTokenForSession(session.id, config.sessionSecret), expiresAt };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date, config: Pick<AppConfig, 'nodeEnv'>): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response, config: Pick<AppConfig, 'nodeEnv'>): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: config.nodeEnv === 'production', sameSite: 'lax', path: '/' });
}

export async function findSession(db: Database, token: string) {
  const [row] = await db.select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row;
}

export function publicUser(user: AuthenticatedUser) {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
    hasBillingAccount: user.stripeCustomerId !== null,
  };
}