/** Dashboard login / logout. */
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { loginLimiter } from '../middleware/rateLimit';
import { verifyCredentials } from '../middleware/auth';
import { audit, AuditEvent } from '../services/auditService';

export function buildAuthRouter(): Router {
  const router = Router();

  router.get('/login', (req, res) => {
    if (req.session?.user) return res.redirect('/');
    res.render('login', {
      title: 'Sign in',
      layout: false,
      active: '',
      error: null,
      next: typeof req.query.next === 'string' ? req.query.next : '/',
    });
  });

  router.post(
    '/login',
    loginLimiter,
    asyncHandler(async (req, res) => {
      const { username, password, next: nextUrl } = req.body as Record<string, string>;
      const valid = await verifyCredentials(username, password);

      if (!valid) {
        await audit.warn(AuditEvent.DashboardLoginFailed, { username, ip: req.ip });
        res.status(401).render('login', {
          title: 'Sign in',
          layout: false,
          active: '',
          error: 'Invalid username or password.',
          next: nextUrl ?? '/',
        });
        return;
      }

      // Prevents session fixation: a fresh id after the privilege change.
      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((err) => (err ? reject(err) : resolve()));
      });
      req.session.user = { username, loggedInAt: new Date().toISOString() };
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });

      await audit.info(AuditEvent.DashboardLogin, { username, ip: req.ip });
      // Only relative paths are honoured, so `next` cannot become an open redirect.
      res.redirect(nextUrl && nextUrl.startsWith('/') && !nextUrl.startsWith('//') ? nextUrl : '/');
    }),
  );

  router.post('/logout', (req, res) => {
    const username = req.session?.user?.username;
    req.session.destroy(() => {
      void audit.info(AuditEvent.DashboardLogout, { username });
      res.redirect('/login');
    });
  });

  return router;
}
