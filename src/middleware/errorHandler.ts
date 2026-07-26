/** 404 and centralised error handling for API and dashboard routes. */
import type { NextFunction, Request, Response } from 'express';
import { AppError, NotFoundError } from '../utils/errors';
import { childLogger } from '../utils/logger';
import { audit, AuditEvent } from '../services/auditService';

const log = childLogger('http');

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Route ${req.method} ${req.path}`));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const isAppError = err instanceof AppError;
  const status = isAppError ? err.status : 500;
  const code = isAppError ? err.code : 'INTERNAL_ERROR';
  const message = isAppError && err.expose ? err.message : 'Something went wrong on the server.';
  const details = isAppError ? err.details : undefined;

  if (status >= 500) {
    log.error('Unhandled request error', {
      method: req.method,
      path: req.path,
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
    void audit.error(AuditEvent.Error, { path: req.path, message: (err as Error).message });
  } else {
    log.warn('Request rejected', { method: req.method, path: req.path, status, code, message });
  }

  const wantsJson = req.path.startsWith('/api') || req.accepts(['html', 'json']) === 'json';
  if (wantsJson) {
    res.status(status).json({ success: false, error: { code, message, details } });
    return;
  }

  res.status(status).render('error', {
    title: `Error ${status}`,
    status,
    code,
    message,
    active: '',
  });
}
