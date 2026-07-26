/**
 * Redirects the dashboard to the setup wizard until first-boot configuration is
 * finished. Static assets, the health probe and the REST API are exempt so
 * monitoring and machine clients keep working during setup.
 */
import type { NextFunction, Request, Response } from 'express';
import type { SetupService } from '../services/setupService';

const EXEMPT_PREFIXES = ['/setup', '/static', '/healthz', '/api', '/logout'];

export function setupGuard(setup: SetupService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (EXEMPT_PREFIXES.some((prefix) => req.path.startsWith(prefix))) return next();

    void setup
      .isComplete()
      .then((complete) => {
        if (complete) return next();
        res.redirect('/setup');
      })
      .catch(next);
  };
}

/**
 * Protects the wizard once setup is finished: re-running it must require an
 * authenticated session, otherwise anyone could reset the admin password.
 */
export function guardCompletedSetup(setup: SetupService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void setup
      .isComplete()
      .then((complete) => {
        if (!complete) return next();
        if (req.session?.user) return next();
        res.redirect('/login');
      })
      .catch(next);
  };
}
