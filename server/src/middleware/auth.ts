import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/index.js';
import { AppError } from '../errors.js';
import { csrfTokenForSession, findSession, secureEqual, SESSION_COOKIE } from '../services/auth.js';

export function requireOrigin(config: Pick<AppConfig, 'appUrl'>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const origin = req.get('origin');
    const fetchSite = req.get('sec-fetch-site');
    if (origin !== config.appUrl || fetchSite === 'cross-site') {
      next(new AppError(403, 'INVALID_ORIGIN', 'This request origin is not allowed.'));
      return;
    }
    next();
  };
}

export function requireAuth(db: Database, config: Pick<AppConfig, 'sessionSecret'>): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token.length === 0 || token.length > 128) {
      next(new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue.'));
      return;
    }
    const row = await findSession(db, token);
    if (!row) {
      next(new AppError(401, 'UNAUTHENTICATED', 'Your session has expired. Sign in again.'));
      return;
    }
    req.auth = {
      user: row.user,
      sessionId: row.session.id,
      csrfToken: csrfTokenForSession(row.session.id, config.sessionSecret),
    };
    next();
  };
}

export function requireCsrf(req: Request, _res: Response, next: NextFunction): void {
  const token = req.get('x-csrf-token');
  if (!req.auth || !token || !secureEqual(token, req.auth.csrfToken)) {
    next(new AppError(403, 'INVALID_CSRF_TOKEN', 'The security token is missing or invalid. Refresh and try again.'));
    return;
  }
  next();
}