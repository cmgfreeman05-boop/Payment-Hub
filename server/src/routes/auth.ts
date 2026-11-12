import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/index.js';
import { sessions, users } from '../db/schema.js';
import { AppError } from '../errors.js';
import { requireAuth, requireCsrf, requireOrigin } from '../middleware/auth.js';
import { clearSessionCookie, createSession, hashPassword, publicUser, setSessionCookie, verifyPassword } from '../services/auth.js';

const credentialsSchema = z.object({
  email: z.string().trim().min(3).max(254).transform((value) => value.toLowerCase()).pipe(z.email()),
  password: z.string().min(12).max(128),
});

export function authRouter(db: Database, config: AppConfig): Router {
  const router = Router();
  const origin = requireOrigin(config);
  const auth = requireAuth(db, config);

  router.post('/register', origin, async (req, res) => {
    const input = credentialsSchema.parse(req.body);
    const passwordHash = await hashPassword(input.password);
    const [user] = await db.insert(users).values({ email: input.email, passwordHash }).onConflictDoNothing().returning();
    if (!user) throw new AppError(409, 'EMAIL_REGISTERED', 'An account with this email already exists.');
    const session = await createSession(db, user.id, config);
    setSessionCookie(res, session.token, session.expiresAt, config);
    res.status(201).json({ user: publicUser(user), csrfToken: session.csrfToken });
  });

  router.post('/login', origin, async (req, res) => {
    const input = credentialsSchema.parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    if (!user || !(await verifyPassword(user.passwordHash, input.password))) throw new AppError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
    const session = await createSession(db, user.id, config);
    setSessionCookie(res, session.token, session.expiresAt, config);
    res.json({ user: publicUser(user), csrfToken: session.csrfToken });
  });

  router.post('/logout', origin, auth, requireCsrf, async (req, res) => {
    await db.delete(sessions).where(eq(sessions.id, req.auth!.sessionId));
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  router.get('/me', auth, (req, res) => {
    res.json({ user: publicUser(req.auth!.user), csrfToken: req.auth!.csrfToken });
  });

  return router;
}