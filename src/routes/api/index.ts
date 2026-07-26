/**
 * REST API (v1).
 *
 * Every response follows `{ success, data | error }` so clients can branch on
 * one shape. Authentication: dashboard session or `X-API-Key`.
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config';
import { getTimezone } from '../../config/runtime';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireApiAuth } from '../../middleware/auth';
import { apiLimiter, sendLimiter } from '../../middleware/rateLimit';
import { describeCron, validateCron } from '../../utils/cron';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { tryParsePhoneNumber } from '../../utils/phone';
import { TemplateRepository } from '../../repositories/templateRepository';
import { HolidayRepository } from '../../repositories/holidayRepository';
import { OutboxRepository } from '../../repositories/outboxRepository';
import {
  broadcastSchema,
  createScheduleSchema,
  groupToggleSchema,
  holidaySchema,
  idParam,
  logQuerySchema,
  meetingReminderSchema,
  sendMessageSchema,
  settingsSchema,
  validateNumberSchema,
  templateSchema,
  updateScheduleSchema,
} from './schemas';
import type { Container } from '../../container';
import type { StatusSnapshot } from '../../models/types';

const ok = <T>(data: T) => ({ success: true as const, data });

/** Application version, read once from package.json (best effort). */
const APP_VERSION: string = (() => {
  try {
    const raw = readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

export function buildApiRouter(container: Container): Router {
  const router = Router();
  const templates = new TemplateRepository();
  const holidays = new HolidayRepository();
  const outbox = new OutboxRepository();

  router.use(apiLimiter);
  router.use(requireApiAuth);

  /* ── Status ──────────────────────────────────────────────────────────── */

  router.get(
    '/status',
    asyncHandler(async (_req, res) => {
      const info = container.gateway.getInfo();
      const queue = await container.queue.stats();
      const snapshot: StatusSnapshot = {
        status: container.gateway.status,
        connected: container.gateway.isReady,
        pushname: info.pushname,
        wid: info.wid,
        qrAvailable: Boolean(container.gateway.getQrDataUrl()),
        lastQrAt: info.lastQrAt,
        connectedSince: info.connectedSince,
        reconnectAttempts: info.reconnectAttempts,
        dryRun: config.whatsapp.dryRun,
        uptimeSeconds: Math.floor((Date.now() - container.startedAt.getTime()) / 1000),
        queue,
        scheduler: { enabled: container.scheduler.isRunning, activeJobs: container.scheduler.activeJobCount },
        ai: { enabled: config.ai.enabled, provider: container.ai.providerName, ready: container.ai.isReady },
        version: APP_VERSION,
      };
      res.json(ok(snapshot));
    }),
  );

  router.get(
    '/status/qr',
    asyncHandler(async (_req, res) => {
      const dataUrl = container.gateway.getQrDataUrl();
      if (!dataUrl) throw new NotFoundError('QR code');
      res.json(ok({ dataUrl, generatedAt: container.gateway.getInfo().lastQrAt }));
    }),
  );

  router.post('/status/restart', asyncHandler(async (_req, res) => {
    await container.gateway.restart();
    res.json(ok({ restarted: true }));
  }));

  router.post('/status/logout', asyncHandler(async (_req, res) => {
    await container.gateway.logout();
    res.json(ok({ loggedOut: true }));
  }));

  /* ── Groups ──────────────────────────────────────────────────────────── */

  router.get(
    '/groups',
    asyncHandler(async (req, res) => {
      const enabledOnly = req.query.enabled === 'true';
      res.json(ok(await container.groups.list(enabledOnly)));
    }),
  );

  router.post('/groups/sync', asyncHandler(async (_req, res) => {
    res.json(ok(await container.groups.sync()));
  }));

  router.get(
    '/groups/:id',
    validate(idParam, 'params'),
    asyncHandler(async (req, res) => {
      res.json(ok(await container.groups.getById(Number(req.params.id))));
    }),
  );

  router.patch(
    '/groups/:id',
    validate(idParam, 'params'),
    validate(groupToggleSchema),
    asyncHandler(async (req, res) => {
      const { enabled } = req.body as { enabled: boolean };
      res.json(ok(await container.groups.setEnabled(Number(req.params.id), enabled)));
    }),
  );

  router.get(
    '/groups/:id/stats',
    validate(idParam, 'params'),
    validate(z.object({ days: z.coerce.number().int().min(1).max(365).optional().default(7) }), 'query'),
    asyncHandler(async (req, res) => {
      const days = Number((req.query as { days?: number }).days ?? 7);
      res.json(ok(await container.analytics.groupStats(Number(req.params.id), days)));
    }),
  );

  /* ── Messages ────────────────────────────────────────────────────────── */

  router.post(
    '/message',
    sendLimiter,
    validate(sendMessageSchema),
    asyncHandler(async (req, res) => {
      const payload = req.body as z.infer<typeof sendMessageSchema>;
      const record = await container.messages.send({ ...payload, source: 'api' });
      if (!record) {
        res.status(202).json(ok({ queued: false, reason: 'suppressed (group disabled or duplicate)' }));
        return;
      }
      res.status(201).json(ok({ queued: true, outboxId: record.id, status: record.status }));
    }),
  );

  router.post(
    '/message/broadcast',
    sendLimiter,
    validate(broadcastSchema),
    asyncHandler(async (req, res) => {
      const { message, mentionAll } = req.body as z.infer<typeof broadcastSchema>;
      res.status(201).json(ok(await container.messages.broadcast(message, { mentionAll, source: 'broadcast' })));
    }),
  );

  /** Parses a typed number and checks whether it is on WhatsApp. */
  router.post(
    '/message/validate-number',
    validate(validateNumberSchema),
    asyncHandler(async (req, res) => {
      const { phone } = req.body as z.infer<typeof validateNumberSchema>;
      const parsed = tryParsePhoneNumber(phone);
      if (!parsed) {
        res.json(ok({ valid: false, reason: 'Could not read that as a phone number.' }));
        return;
      }
      let registered: boolean | null = null;
      if (container.gateway.isReady) {
        registered = (await container.gateway.resolveNumber(parsed.digits)).registered;
      }
      res.json(ok({ valid: true, display: parsed.display, chatId: parsed.chatId, registered }));
    }),
  );

  router.get(
    '/queue',
    asyncHandler(async (req, res) => {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      res.json(
        ok({
          stats: await container.queue.stats(),
          items: await outbox.list(status as never, 100),
        }),
      );
    }),
  );

  router.post(
    '/queue/:id/retry',
    validate(idParam, 'params'),
    asyncHandler(async (req, res) => {
      const retried = await outbox.retryFailed(Number(req.params.id));
      res.json(ok({ retried }));
    }),
  );

  router.delete(
    '/queue/:id',
    validate(idParam, 'params'),
    asyncHandler(async (req, res) => {
      res.json(ok({ cancelled: await outbox.cancel(Number(req.params.id)) }));
    }),
  );

  /* ── Schedules ───────────────────────────────────────────────────────── */

  router.get(
    '/schedule',
    asyncHandler(async (req, res) => {
      const groupId = req.query.groupId ? Number(req.query.groupId) : undefined;
      const schedules = await container.schedules.list(groupId ? { groupId } : {});
      res.json(ok(schedules.map((s) => ({ ...s, description: describeCron(s.cron) }))));
    }),
  );

  router.post(
    '/schedule',
    validate(createScheduleSchema),
    asyncHandler(async (req, res) => {
      const schedule = await container.schedules.create(req.body as z.infer<typeof createScheduleSchema>);
      res.status(201).json(ok({ ...schedule, description: describeCron(schedule.cron) }));
    }),
  );

  router.get(
    '/schedule/:id',
    validate(idParam, 'params'),
    asyncHandler(async (req, res) => {
      const schedule = await container.schedules.get(Number(req.params.id));
      res.json(ok({ ...schedule, description: describeCron(schedule.cron) }));
    }),
  );

  router.patch(
    '/schedule/:id',
    validate(idParam, 'params'),
    validate(updateScheduleSchema),
    asyncHandler(async (req, res) => {
      const schedule = await container.schedules.update(Number(req.params.id), req.body as never);
      res.json(ok({ ...schedule, description: describeCron(schedule.cron) }));
    }),
  );

  router.delete(
    '/schedule/:id',
    validate(idParam, 'params'),
    asyncHandler(async (req, res) => {
      await container.schedules.remove(Number(req.params.id));
      res.json(ok({ deleted: true }));
    }),
  );

  router.post(
    '/schedule/:id/run',
    validate(idParam, 'params'),
    asyncHandler(async (req, res) => {
      const result = await container.scheduler.fire(Number(req.params.id), { manual: true });
      res.json(ok({ result }));
    }),
  );

  /** Convenience endpoint: creates a one-shot meeting reminder. */
  router.post(
    '/schedule/meeting',
    validate(meetingReminderSchema),
    asyncHandler(async (req, res) => {
      const { groupId, title, startsAt, minutesBefore, message } = req.body as z.infer<typeof meetingReminderSchema>;
      const fireAt = new Date(new Date(startsAt).getTime() - minutesBefore * 60_000);
      if (fireAt.getTime() <= Date.now()) {
        throw new ValidationError('The reminder time is already in the past.');
      }
      // Minute-precision one-shot cron in the configured timezone.
      const local = new Date(fireAt.toLocaleString('en-US', { timeZone: getTimezone() }));
      const cron = `${local.getMinutes()} ${local.getHours()} ${local.getDate()} ${local.getMonth() + 1} *`;
      const schedule = await container.schedules.create({
        groupId,
        name: `Meeting: ${title}`,
        kind: 'meeting',
        cron,
        message:
          message ??
          `Reminder ⏰\n\n${title} starts in ${minutesBefore} minutes.\nPlease join on time.`,
        runOnce: true,
        skipHolidays: false,
      });
      res.status(201).json(ok({ ...schedule, firesAt: fireAt.toISOString(), description: describeCron(cron) }));
    }),
  );

  router.post(
    '/schedule/validate-cron',
    validate(z.object({ cron: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const { cron } = req.body as { cron: string };
      const result = validateCron(cron);
      res.json(ok({ ...result, description: result.valid ? describeCron(cron) : undefined }));
    }),
  );

  /* ── Logs ────────────────────────────────────────────────────────────── */

  router.get(
    '/logs',
    validate(logQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
      const query = req.query as unknown as z.infer<typeof logQuerySchema>;
      res.json(ok(await container.audit.query(query)));
    }),
  );

  router.get('/logs/events', asyncHandler(async (_req, res) => {
    res.json(ok(await container.audit.distinctEvents()));
  }));

  router.delete('/logs', asyncHandler(async (_req, res) => {
    res.json(ok({ removed: await container.audit.clear() }));
  }));

  /* ── Templates ───────────────────────────────────────────────────────── */

  router.get(
    '/templates',
    asyncHandler(async (req, res) => {
      const category = typeof req.query.category === 'string' ? req.query.category : undefined;
      res.json(ok(await templates.list(category)));
    }),
  );

  router.post(
    '/templates',
    validate(templateSchema),
    asyncHandler(async (req, res) => {
      res.status(201).json(ok(await templates.create(req.body as z.infer<typeof templateSchema>)));
    }),
  );

  router.patch(
    '/templates/:id',
    validate(idParam, 'params'),
    validate(templateSchema.partial()),
    asyncHandler(async (req, res) => {
      const updated = await templates.update(Number(req.params.id), req.body as never);
      if (!updated) throw new NotFoundError('Template');
      res.json(ok(updated));
    }),
  );

  router.delete(
    '/templates/:id',
    validate(idParam, 'params'),
    asyncHandler(async (req, res) => {
      res.json(ok({ deleted: await templates.remove(Number(req.params.id)) }));
    }),
  );

  /* ── Settings & AI ───────────────────────────────────────────────────── */

  router.get('/settings', asyncHandler(async (_req, res) => {
    res.json(ok(await container.settings.get()));
  }));

  router.put(
    '/settings',
    validate(settingsSchema),
    asyncHandler(async (req, res) => {
      const patch = req.body as Record<string, string>;
      const settings = await container.settings.update(patch);
      if (patch['ai.provider']) container.ai.useProvider(patch['ai.provider']);
      res.json(ok(settings));
    }),
  );

  /* ── Analytics & holidays ────────────────────────────────────────────── */

  router.get(
    '/analytics',
    asyncHandler(async (req, res) => {
      const days = req.query.days ? Number(req.query.days) : 7;
      res.json(ok(await container.analytics.overview(days)));
    }),
  );

  router.get(
    '/analytics/export',
    asyncHandler(async (req, res) => {
      const days = req.query.days ? Number(req.query.days) : 30;
      res.header('Content-Type', 'text/csv; charset=utf-8');
      res.header('Content-Disposition', `attachment; filename="chat-statistics-${days}d.csv"`);
      res.send(await container.analytics.exportCsv(days));
    }),
  );

  router.get('/holidays', asyncHandler(async (_req, res) => {
    res.json(ok(await holidays.list()));
  }));

  router.post(
    '/holidays',
    validate(holidaySchema),
    asyncHandler(async (req, res) => {
      const { date, name } = req.body as z.infer<typeof holidaySchema>;
      res.status(201).json(ok(await holidays.add(date, name)));
    }),
  );

  router.delete(
    '/holidays/:id',
    validate(idParam, 'params'),
    asyncHandler(async (req, res) => {
      res.json(ok({ deleted: await holidays.remove(Number(req.params.id)) }));
    }),
  );

  /* ── Backups ─────────────────────────────────────────────────────────── */

  router.get('/backups', asyncHandler(async (_req, res) => {
    res.json(ok(await container.backups.list()));
  }));

  router.post('/backups', asyncHandler(async (_req, res) => {
    const { file } = await container.backups.create();
    res.status(201).json(ok({ file: file.split(/[\\/]/).pop() }));
  }));

  router.post(
    '/backups/restore',
    validate(z.object({ file: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const { file } = req.body as { file: string };
      res.json(ok(await container.backups.restore(file)));
    }),
  );

  return router;
}
