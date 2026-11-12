import type { users } from '../db/schema.js';

export type AuthenticatedUser = typeof users.$inferSelect;

export type AuthContext = {
  user: AuthenticatedUser;
  sessionId: string;
  csrfToken: string;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}