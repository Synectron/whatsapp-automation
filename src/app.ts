/**
 * Express application factory.
 *
 * Kept free of side effects (no listening, no WhatsApp bootstrap) so tests can
 * build an app around a fake container.
 */
import path from 'node:path';
import express, { type Express } from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { config } from './config';
import { childLogger } from './utils/logger';
import { KnexSessionStore } from './middleware/sessionStore';
import { csrfProtection } from './middleware/csrf';
import { exposeUser, initAuth } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { buildApiRouter } from './routes/api';
import { buildAuthRouter } from './routes/auth';
import { buildDashboardRouter } from './routes/dashboard';
import { buildSetupRouter } from './routes/setup';
import { setupGuard } from './middleware/setupGuard';
import { getTimezone } from './config/runtime';
import { healthcheck } from './database';
import type { Container } from './container';

const log = childLogger('app');

export interface CreateAppOptions {
  /** Skip the persistent session store (used by tests). */
  ephemeralSessions?: boolean;
}

export function createApp(container: Container, options: CreateAppOptions = {}): Express {
  const app = express();

  initAuth();

  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', config.paths.views);
  app.locals.appName = 'WhatsApp Group Assistant';

  // Security headers. The Tailwind Play CDN needs inline styles/scripts; swap
  // to a compiled stylesheet and tighten this policy for maximum hardening.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://cdn.tailwindcss.com', "'unsafe-inline'"],
          styleSrc: ["'self'", 'https://cdn.tailwindcss.com', "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'self'"],
          baseUri: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'same-origin' },
    }),
  );

  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: true, limit: '256kb' }));
  app.use(requestLogger);
  app.use('/static', express.static(config.paths.public, { maxAge: config.isProduction ? '7d' : 0 }));

  app.use(
    session({
      name: 'wga.sid',
      secret: config.auth.sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store: options.ephemeralSessions
        ? undefined
        : new KnexSessionStore({ defaultTtlMs: config.auth.sessionTtlMs }),
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.auth.secureCookie,
        maxAge: config.auth.sessionTtlMs,
      },
    }),
  );

  app.use(exposeUser);

  // Flash messages are carried in the query string by dashboard redirects.
  app.use((req, res, next) => {
    res.locals.flash = typeof req.query.flash === 'string' ? req.query.flash : null;
    res.locals.flashType = req.query.type === 'error' ? 'error' : 'ok';
    res.locals.currentPath = req.path;
    // Read per request: the setup wizard can change it at runtime.
    res.locals.timezone = getTimezone();
    next();
  });

  /** Liveness + readiness probe (public, no auth). */
  app.get('/healthz', async (_req, res) => {
    const dbOk = await healthcheck();
    res.status(dbOk ? 200 : 503).json({
      status: dbOk ? 'ok' : 'degraded',
      whatsapp: container.gateway.status,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api', buildApiRouter(container));

  // CSRF applies to cookie-authenticated HTML forms only; it runs after /api
  // so machine clients using X-API-Key are unaffected.
  app.use(csrfProtection);
  app.use('/', buildSetupRouter(container));
  // Everything below is unreachable until first-boot setup is finished.
  app.use(setupGuard(container.setup));
  app.use('/', buildAuthRouter());
  app.use('/', buildDashboardRouter(container));

  app.use(notFoundHandler);
  app.use(errorHandler);

  log.info('Express application configured', { views: path.basename(config.paths.views) });
  return app;
}
