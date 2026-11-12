import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { Logger } from '../logger.js';
import { AppError } from '../errors.js';

export function notFoundHandler(): RequestHandler {
  return (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'The requested resource was not found.'));
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error, req, res, _next) => {
    if (error instanceof AppError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof ZodError) {
      res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'The request contains invalid fields.', fields: error.flatten().fieldErrors } });
      return;
    }
    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: { code: 'INVALID_JSON', message: 'The request body is not valid JSON.' } });
      return;
    }
    logger.error({ err: error, requestId: req.id }, 'Unhandled request error');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred. Try again later.' } });
  };
}