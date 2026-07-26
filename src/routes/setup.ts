/**
 * First-boot wizard.
 *
 * Four steps: administrator account → localization → link WhatsApp → pick
 * groups (and optionally create starter reminders). Each step persists on
 * submit, so a refresh or a restart never loses progress.
 */
import { Router, type Response } from 'express';
import { COMMON_TIMEZONES, getLocale, getTimezone } from '../config/runtime';
import { asyncHandler } from '../middleware/asyncHandler';
import { guardCompletedSetup } from '../middleware/setupGuard';
import { ValidationError } from '../utils/errors';
import { describeCron } from '../utils/cron';
import type { Container } from '../container';

/** Reminders offered on the final step. */
const STARTER_SCHEDULES = [
  {
    key: 'daily',
    label: 'Daily check-in — weekdays 09:30',
    name: 'Daily check-in',
    cron: '30 9 * * 1-5',
    message:
      'Good morning everyone 👋\n\nQuick check-in:\n' +
      '• What are you working on today?\n' +
      '• Any blockers?\n' +
      '• Does anyone need help?\n\n' +
      'Reply here so everyone stays aligned.',
  },
  {
    key: 'monday',
    label: 'Monday planning — 09:00',
    name: 'Monday planning',
    cron: '0 9 * * 1',
    message:
      'Monday Planning 🗓️\n\n' +
      '• What are your top 3 priorities this week?\n' +
      '• Anything that needs a decision from the team?\n' +
      '• Any dependencies on someone else?\n\n' +
      'Drop your plan below.',
  },
  {
    key: 'friday',
    label: 'Friday wrap-up — 17:00',
    name: 'Friday wrap-up',
    cron: '0 17 * * 5',
    message:
      'Weekly Check-in 📅\n\n' +
      '• What was completed?\n' +
      "• What's pending?\n" +
      '• Any risks?\n' +
      '• Need help before next week?',
  },
] as const;

const STEPS = [
  { number: 1, title: 'Administrator' },
  { number: 2, title: 'Localization' },
  { number: 3, title: 'Link WhatsApp' },
  { number: 4, title: 'Groups' },
] as const;

export function buildSetupRouter(container: Container): Router {
  const router = Router();
  const setup = container.setup;

  // Scoped to /setup so completing the wizard cannot bounce /login into a loop.
  router.use('/setup', guardCompletedSetup(setup));

  /** Renders one wizard step. */
  const render = async (res: Response, step: number, extra: Record<string, unknown> = {}) => {
    const groups = step === 4 ? await container.groups.list() : [];
    res.render('setup', {
      title: 'Setup',
      active: '',
      step,
      steps: STEPS,
      timezones: COMMON_TIMEZONES,
      currentTimezone: getTimezone(),
      currentLocale: getLocale(),
      envConfigured: setup.isEnvConfigured,
      connectionStatus: container.gateway.status,
      connected: container.gateway.isReady,
      qr: container.gateway.getQrDataUrl(),
      groups,
      starters: STARTER_SCHEDULES,
      describeCron,
      error: null,
      ...extra,
    });
  };

  router.get(
    '/setup',
    asyncHandler(async (req, res) => {
      const requested = Number(req.query.step ?? 1);
      const step = Number.isFinite(requested) && requested >= 1 && requested <= 4 ? requested : 1;
      // Skip the account step entirely when credentials come from the environment.
      await render(res, setup.isEnvConfigured && step === 1 ? 2 : step);
    }),
  );

  /* ── Step 1 · administrator account ──────────────────────────────────── */
  router.post(
    '/setup/account',
    asyncHandler(async (req, res) => {
      const { username, password, confirmPassword } = req.body as Record<string, string>;
      try {
        await setup.createAdmin({ username, password, confirmPassword });
      } catch (err) {
        if (err instanceof ValidationError) {
          await render(res, 1, { error: err.message });
          return;
        }
        throw err;
      }
      res.redirect('/setup?step=2');
    }),
  );

  /* ── Step 2 · localization ───────────────────────────────────────────── */
  router.post(
    '/setup/localization',
    asyncHandler(async (req, res) => {
      const { timezone, locale, signature } = req.body as Record<string, string>;
      try {
        await setup.saveLocalization({ timezone, locale, signature });
      } catch (err) {
        if (err instanceof ValidationError) {
          await render(res, 2, { error: err.message });
          return;
        }
        throw err;
      }
      // Cron jobs are registered with a fixed timezone, so rebuild them.
      await container.scheduler.reload();
      res.redirect('/setup?step=3');
    }),
  );

  /**
   * Connection state for the wizard's QR poll. Public by necessity — the
   * operator has no session yet — so it exposes nothing beyond link status.
   */
  router.get(
    '/setup/status',
    asyncHandler(async (_req, res) => {
      res.json({
        status: container.gateway.status,
        connected: container.gateway.isReady,
        qrAvailable: Boolean(container.gateway.getQrDataUrl()),
      });
    }),
  );

  /* ── Step 3 · link WhatsApp ──────────────────────────────────────────── */
  router.post(
    '/setup/connect/restart',
    asyncHandler(async (_req, res) => {
      await container.gateway.restart();
      res.redirect('/setup?step=3');
    }),
  );

  router.post(
    '/setup/connect/sync',
    asyncHandler(async (_req, res) => {
      await container.groups.sync();
      res.redirect('/setup?step=4');
    }),
  );

  /* ── Step 4 · groups and starter reminders ───────────────────────────── */
  router.post(
    '/setup/groups',
    asyncHandler(async (req, res) => {
      const body = req.body as Record<string, string | string[]>;
      const selected = ([] as string[])
        .concat(body.groupIds ?? [])
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0);
      const starters = ([] as string[]).concat(body.starters ?? []);

      for (const id of selected) {
        await container.groups.setEnabled(id, true);
        for (const starter of STARTER_SCHEDULES.filter((s) => starters.includes(s.key))) {
          await container.schedules.create({
            groupId: id,
            name: starter.name,
            cron: starter.cron,
            message: starter.message,
            kind: 'reminder',
            enabled: true,
            skipHolidays: true,
          });
        }
      }

      await setup.complete({ groups: selected.length, starters: starters.length });

      // The wizard runs unauthenticated, so send the operator to sign in.
      res.redirect(req.session?.user ? '/' : '/login');
    }),
  );

  return router;
}
