/**
 * Double-submit CSRF protection for dashboard forms.
 *
 * A per-session secret produces a token that must accompany every unsafe
 * request. API-key clients are exempt (no ambient cookie authority to abuse).
 */
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError } from '../utils/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function secretFor(req: Request): string {
  if (!req.session) throw new ForbiddenError('Session is unavailable — cannot validate CSRF token.');
  if (!req.session.csrfSecret) req.session.csrfSecret = crypto.randomBytes(32).toString('hex');
  return req.session.csrfSecret;
}

/** Derives the token a client must echo back. */
export function csrfToken(req: Request): string {
  return crypto.createHmac('sha256', secretFor(req)).update('csrf').digest('hex');
}

/** Publishes `csrfToken` to templates and validates unsafe requests. */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  try {
    res.locals.csrfToken = req.session ? csrfToken(req) : '';

    if (SAFE_METHODS.has(req.method)) return next();
    // API-key authenticated calls are not cookie-driven, so CSRF does not apply.
    if (!req.session?.user && req.header('x-api-key')) return next();

    const body = req.body as Record<string, unknown> | undefined;
    const provided =
      (typeof body?._csrf === 'string' ? body._csrf : undefined) ??
      req.header('x-csrf-token') ??
      (typeof req.query._csrf === 'string' ? req.query._csrf : undefined);

    const expected = csrfToken(req);
    if (
      !provided ||
      provided.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    ) {
      throw new ForbiddenError('Invalid or missing CSRF token.');
    }
    next();
  } catch (err) {
    next(err);
  }
}
