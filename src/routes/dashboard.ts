/**
 * Server-rendered dashboard (EJS + Tailwind).
 *
 * Form posts are thin wrappers over the same services the REST API uses, then
 * redirect back with a flash message in the query string.
 */
import { Router } from 'express';
import { config } from '../config';
import { getTimezone } from '../config/runtime';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireDashboardAuth } from '../middleware/auth';
import { describeCron } from '../utils/cron';
import { formatLocal } from '../utils/time';
import { TemplateRepository } from '../repositories/templateRepository';
import { HolidayRepository } from '../repositories/holidayRepository';
import { OutboxRepository } from '../repositories/outboxRepository';
import type { Container } from '../container';
import type { ScheduleKind } from '../models/types';

/** Builds a redirect URL carrying a flash message. */
const flash = (path: string, message: string, type: 'ok' | 'error' = 'ok') =>
  `${path}?flash=${encodeURIComponent(message)}&type=${type}`;

export function buildDashboardRouter(container: Container): Router {
  const router = Router();
  const templates = new TemplateRepository();
  const holidays = new HolidayRepository();
  const outbox = new OutboxRepository();

  router.use(requireDashboardAuth);

  /* ── Overview / connection ───────────────────────────────────────────── */

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const [groups, queue, counts, recentLogs] = await Promise.all([
        container.groups.list(),
        container.queue.stats(),
        container.groups.counts(),
        container.audit.query({ limit: 8 }),
      ]);
      const info = container.gateway.getInfo();
      res.render('index', {
        title: 'Overview',
        active: 'overview',
        status: container.gateway.status,
        connected: container.gateway.isReady,
        info,
        qr: container.gateway.getQrDataUrl(),
        groups,
        counts,
        queue,
        recentLogs: recentLogs.items,
        scheduler: { running: container.scheduler.isRunning, jobs: container.scheduler.activeJobCount },
        ai: { provider: container.ai.providerName, ready: container.ai.isReady },
        dryRun: config.whatsapp.dryRun,
        formatLocal,
      });
    }),
  );

  router.post(
    '/connection/restart',
    asyncHandler(async (_req, res) => {
      await container.gateway.restart();
      res.redirect(flash('/', 'WhatsApp client restarting…'));
    }),
  );

  router.post(
    '/connection/logout',
    asyncHandler(async (_req, res) => {
      await container.gateway.logout();
      res.redirect(flash('/', 'Logged out of WhatsApp. Scan the new QR code to reconnect.'));
    }),
  );

  /* ── Groups ──────────────────────────────────────────────────────────── */

  router.get(
    '/groups',
    asyncHandler(async (_req, res) => {
      res.render('groups', {
        title: 'Groups',
        active: 'groups',
        groups: await container.groups.list(),
        connected: container.gateway.isReady,
        formatLocal,
      });
    }),
  );

  router.post(
    '/groups/sync',
    asyncHandler(async (_req, res) => {
      const { discovered } = await container.groups.sync();
      res.redirect(flash('/groups', `Synced ${discovered} group(s) from WhatsApp.`));
    }),
  );

  router.post(
    '/groups/:id/toggle',
    asyncHandler(async (req, res) => {
      const enabled = req.body.enabled === 'true';
      const group = await container.groups.setEnabled(Number(req.params.id), enabled);
      res.redirect(flash('/groups', `${group.name} reminders ${enabled ? 'enabled' : 'disabled'}.`));
    }),
  );

  /* ── Schedules ───────────────────────────────────────────────────────── */

  router.get(
    '/schedules',
    asyncHandler(async (_req, res) => {
      const [schedules, groups, tpl] = await Promise.all([
        container.schedules.list(),
        container.groups.list(),
        templates.list(),
      ]);
      res.render('schedules', {
        title: 'Schedules',
        active: 'schedules',
        schedules: schedules.map((s) => ({ ...s, description: describeCron(s.cron) })),
        groups,
        templates: tpl,
        timezone: getTimezone(),
        formatLocal,
      });
    }),
  );

  router.post(
    '/schedules',
    asyncHandler(async (req, res) => {
      const body = req.body as Record<string, string>;
      try {
        await container.schedules.create({
          groupId: Number(body.groupId),
          name: body.name,
          cron: body.cron,
          message: body.message,
          kind: (body.kind as ScheduleKind) || 'reminder',
          enabled: body.enabled === 'on',
          mentionAll: body.mentionAll === 'on',
          skipHolidays: body.skipHolidays === 'on',
          runOnce: body.runOnce === 'on',
        });
        res.redirect(flash('/schedules', 'Schedule created.'));
      } catch (err) {
        res.redirect(flash('/schedules', (err as Error).message, 'error'));
      }
    }),
  );

  router.post(
    '/schedules/:id/update',
    asyncHandler(async (req, res) => {
      const body = req.body as Record<string, string>;
      try {
        await container.schedules.update(Number(req.params.id), {
          name: body.name,
          cron: body.cron,
          message: body.message,
          enabled: body.enabled === 'on',
          mentionAll: body.mentionAll === 'on',
          skipHolidays: body.skipHolidays === 'on',
        });
        res.redirect(flash('/schedules', 'Schedule updated.'));
      } catch (err) {
        res.redirect(flash('/schedules', (err as Error).message, 'error'));
      }
    }),
  );

  router.post(
    '/schedules/:id/toggle',
    asyncHandler(async (req, res) => {
      await container.schedules.toggle(Number(req.params.id), req.body.enabled === 'true');
      res.redirect(flash('/schedules', 'Schedule updated.'));
    }),
  );

  router.post(
    '/schedules/:id/run',
    asyncHandler(async (req, res) => {
      const result = await container.scheduler.fire(Number(req.params.id), { manual: true });
      res.redirect(flash('/schedules', `Manual run: ${result}.`));
    }),
  );

  router.post(
    '/schedules/:id/delete',
    asyncHandler(async (req, res) => {
      await container.schedules.remove(Number(req.params.id));
      res.redirect(flash('/schedules', 'Schedule deleted.'));
    }),
  );

  /* ── Manual send ─────────────────────────────────────────────────────── */

  router.get(
    '/send',
    asyncHandler(async (_req, res) => {
      res.render('send', {
        title: 'Send message',
        active: 'send',
        groups: await container.groups.list(),
        templates: await templates.list(),
        queue: await outbox.list(undefined, 25),
        formatLocal,
      });
    }),
  );

  router.post(
    '/send',
    asyncHandler(async (req, res) => {
      const body = req.body as Record<string, string>;
      try {
        if (body.broadcast === 'on') {
          const results = await container.messages.broadcast(body.message, {
            mentionAll: body.mentionAll === 'on',
            source: 'dashboard:broadcast',
          });
          res.redirect(flash('/send', `Broadcast queued for ${results.filter((r) => r.queued).length} group(s).`));
          return;
        }
        const record = await container.messages.send({
          groupId: Number(body.groupId),
          message: body.message,
          mentionAll: body.mentionAll === 'on',
          source: 'dashboard',
          force: true,
        });
        res.redirect(flash('/send', record ? `Message queued (#${record.id}).` : 'Message suppressed.'));
      } catch (err) {
        res.redirect(flash('/send', (err as Error).message, 'error'));
      }
    }),
  );

  router.post(
    '/send/:id/retry',
    asyncHandler(async (req, res) => {
      await outbox.retryFailed(Number(req.params.id));
      res.redirect(flash('/send', 'Message re-queued.'));
    }),
  );

  /* ── Templates ───────────────────────────────────────────────────────── */

  router.get(
    '/templates',
    asyncHandler(async (_req, res) => {
      res.render('templates', {
        title: 'Templates',
        active: 'templates',
        templates: await templates.list(),
        formatLocal,
      });
    }),
  );

  router.post(
    '/templates',
    asyncHandler(async (req, res) => {
      const body = req.body as Record<string, string>;
      await templates.create({
        name: body.name,
        category: body.category || 'general',
        body: body.body,
        enabled: body.enabled === 'on',
      });
      res.redirect(flash('/templates', 'Template saved.'));
    }),
  );

  router.post(
    '/templates/:id/update',
    asyncHandler(async (req, res) => {
      const body = req.body as Record<string, string>;
      await templates.update(Number(req.params.id), {
        name: body.name,
        category: body.category,
        body: body.body,
        enabled: body.enabled === 'on',
      });
      res.redirect(flash('/templates', 'Template updated.'));
    }),
  );

  router.post(
    '/templates/:id/delete',
    asyncHandler(async (req, res) => {
      await templates.remove(Number(req.params.id));
      res.redirect(flash('/templates', 'Template deleted.'));
    }),
  );

  /* ── Logs ────────────────────────────────────────────────────────────── */

  router.get(
    '/logs',
    asyncHandler(async (req, res) => {
      const limit = Math.min(Number(req.query.limit ?? 100), 500);
      const offset = Math.max(Number(req.query.offset ?? 0), 0);
      const level = typeof req.query.level === 'string' && req.query.level ? req.query.level : undefined;
      const event = typeof req.query.event === 'string' && req.query.event ? req.query.event : undefined;

      const { items, total } = await container.audit.query({ limit, offset, level: level as never, event });
      res.render('logs', {
        title: 'Logs',
        active: 'logs',
        logs: items,
        total,
        limit,
        offset,
        level: level ?? '',
        event: event ?? '',
        events: await container.audit.distinctEvents(),
        formatLocal,
      });
    }),
  );

  router.post(
    '/logs/clear',
    asyncHandler(async (_req, res) => {
      const removed = await container.audit.clear();
      res.redirect(flash('/logs', `Cleared ${removed} log entries.`));
    }),
  );

  /* ── Analytics ───────────────────────────────────────────────────────── */

  router.get(
    '/analytics',
    asyncHandler(async (req, res) => {
      const days = Math.min(Math.max(Number(req.query.days ?? 7), 1), 90);
      res.render('analytics', {
        title: 'Analytics',
        active: 'analytics',
        days,
        stats: await container.analytics.overview(days),
        formatLocal,
      });
    }),
  );

  /* ── Settings (AI, inactivity, holidays, backups) ────────────────────── */

  router.get(
    '/settings',
    asyncHandler(async (_req, res) => {
      res.render('settings', {
        title: 'Settings',
        active: 'settings',
        settings: await container.settings.get(),
        ai: { provider: container.ai.providerName, ready: container.ai.isReady },
        holidays: await holidays.list(),
        backups: await container.backups.list(),
        envProvider: config.ai.provider,
        timezone: getTimezone(),
        formatLocal,
      });
    }),
  );

  router.post(
    '/settings',
    asyncHandler(async (req, res) => {
      const body = req.body as Record<string, string>;
      const patch: Record<string, string> = {
        'ai.enabled': body.aiEnabled === 'on' ? 'true' : 'false',
        'ai.provider': body.aiProvider ?? 'none',
        'ai.persona': body.aiPersona ?? '',
        'ai.autoReply': body.aiAutoReply === 'on' ? 'true' : 'false',
        'ai.weeklySummary': body.aiWeeklySummary === 'on' ? 'true' : 'false',
        'inactivity.enabled': body.inactivityEnabled === 'on' ? 'true' : 'false',
        'inactivity.hours': String(Number(body.inactivityHours) || 6),
        'inactivity.message': body.inactivityMessage ?? '',
        'motivation.enabled': body.motivationEnabled === 'on' ? 'true' : 'false',
        'scheduler.enabled': body.schedulerEnabled === 'on' ? 'true' : 'false',
        'branding.signature': body.signature ?? '',
      };
      await container.settings.update(patch);
      container.ai.useProvider(patch['ai.provider']);
      res.redirect(flash('/settings', 'Settings saved.'));
    }),
  );

  router.post(
    '/settings/holidays',
    asyncHandler(async (req, res) => {
      const body = req.body as Record<string, string>;
      await holidays.add(body.date, body.name);
      res.redirect(flash('/settings', 'Holiday added.'));
    }),
  );

  router.post(
    '/settings/holidays/:id/delete',
    asyncHandler(async (req, res) => {
      await holidays.remove(Number(req.params.id));
      res.redirect(flash('/settings', 'Holiday removed.'));
    }),
  );

  router.post(
    '/settings/rerun-setup',
    asyncHandler(async (_req, res) => {
      await container.setup.reset();
      res.redirect('/setup');
    }),
  );

  router.post(
    '/settings/backup',
    asyncHandler(async (_req, res) => {
      const { file } = await container.backups.create();
      res.redirect(flash('/settings', `Backup created: ${file.split(/[\\/]/).pop()}`));
    }),
  );

  router.post(
    '/settings/restore',
    asyncHandler(async (req, res) => {
      try {
        await container.backups.restore((req.body as Record<string, string>).file);
        await container.scheduler.reload();
        res.redirect(flash('/settings', 'Backup restored and schedules reloaded.'));
      } catch (err) {
        res.redirect(flash('/settings', (err as Error).message, 'error'));
      }
    }),
  );

  return router;
}
