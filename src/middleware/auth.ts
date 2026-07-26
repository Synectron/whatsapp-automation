/**
 * Dashboard + API authentication.
 *
 * Dashboard: username/password → signed session cookie.
 * API: the same session, or a constant-time-compared `X-API-Key` header.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { UnauthorizedError } from '../utils/errors';
import { childLogger } from '../utils/logger';
import { SetupService } from '../services/setupService';

const log = childLogger('auth');

declare module 'express-session' {
  interface SessionData {
    user?: { username: string; loggedInAt: string };
    csrfSecret?: string;
  }
}

/** Bcrypt hash of the configured dashboard password, computed once at boot. */
let passwordHash: string | null = null;

export function initAuth(): void {
  if (config.auth.passwordHash) {
    passwordHash = config.auth.passwordHash;
    log.info('Dashboard auth initialised from DASHBOARD_PASSWORD_HASH');
    return;
  }
  if (config.auth.password) {
    passwordHash = bcrypt.hashSync(config.auth.password, 10);
    log.info('Dashboard auth initialised from DASHBOARD_PASSWORD');
    return;
  }
  log.warn('No dashboard password configured — the dashboard will reject every login.');
}

/** Constant-time string comparison that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verifies dashboard credentials.
 *
 * Credentials created by the setup wizard (stored bcrypt-hashed in `settings`)
 * take precedence; the environment is the fallback, which keeps declarative
 * deployments working. The bcrypt comparison always runs so a wrong username
 * and a wrong password cost the same time.
 */
export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  const stored = await new SetupService().storedCredentials().catch(() => null);
  const expectedUser = stored?.username ?? config.auth.username;
  const expectedHash = stored?.passwordHash ?? passwordHash;

  if (!expectedHash) {
    log.warn('Login attempted with no password configured');
    return false;
  }

  const userOk = safeEqual(expectedUser, username ?? '');
  const passOk = await bcrypt.compare(password ?? '', expectedHash);
  return userOk && passOk;
}

/** Redirects unauthenticated browsers to the login page. */
export function requireDashboardAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.user) return next();
  const target = encodeURIComponent(req.originalUrl);
  res.redirect(`/login?next=${target}`);
}

/** Session **or** API key. Used by every /api route. */
export function requireApiAuth(req: Request, _res: Response, next: NextFunction): void {
  if (req.session?.user) return next();

  const provided = req.header('x-api-key');
  if (config.auth.apiKey && provided) {
    const a = Buffer.from(config.auth.apiKey);
    const b = Buffer.from(provided);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  }
  next(new UnauthorizedError('Provide a dashboard session or a valid X-API-Key header.'));
}

/** Exposes the current user to EJS templates. */
export function exposeUser(req: Request, res: Response, next: NextFunction): void {
  res.locals.currentUser = req.session?.user ?? null;
  next();
}

/** Test seam — lets suites install a known hash. */
export function __setPasswordHashForTests(hash: string | null): void {
  passwordHash = hash;
}
