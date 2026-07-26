/**
 * System jobs that run alongside user-defined schedules: inactivity nudges,
 * daily motivation, AI weekly summaries and housekeeping.
 */
import { config } from '../config';
import { childLogger } from '../utils/logger';
import { localDateKey, localHour, isWithinQuietHours } from '../utils/time';
import { pickRandom } from '../utils/templating';
import { audit, AuditEvent } from '../services/auditService';
import { settingsService } from '../services/settingsService';
import { TemplateRepository } from '../repositories/templateRepository';
import { HolidayRepository } from '../repositories/holidayRepository';
import { OutboxRepository } from '../repositories/outboxRepository';
import { ActivityRepository } from '../repositories/activityRepository';
import type { GroupService } from '../services/groupService';
import type { MessageService } from '../services/messageService';
import type { ActivityService } from '../services/activityService';
import type { ScheduleService } from '../services/scheduleService';
import type { AiService } from '../ai';

const log = childLogger('jobs');

export interface JobDeps {
  groups: GroupService;
  messages: MessageService;
  activity: ActivityService;
  schedules: ScheduleService;
  ai: AiService;
  templates?: TemplateRepository;
  holidays?: HolidayRepository;
  outbox?: OutboxRepository;
  activityRepo?: ActivityRepository;
}

export class SystemJobs {
  private readonly templates: TemplateRepository;
  private readonly holidays: HolidayRepository;
  private readonly outbox: OutboxRepository;
  private readonly activityRepo: ActivityRepository;

  constructor(private readonly deps: JobDeps) {
    this.templates = deps.templates ?? new TemplateRepository();
    this.holidays = deps.holidays ?? new HolidayRepository();
    this.outbox = deps.outbox ?? new OutboxRepository();
    this.activityRepo = deps.activityRepo ?? new ActivityRepository();
  }

  /** True when today is a configured holiday and holiday awareness is on. */
  async isHolidayToday(): Promise<{ skip: boolean; name?: string }> {
    if (!config.scheduler.holidayAwareness) return { skip: false };
    const holiday = await this.holidays.isHoliday(localDateKey());
    return holiday ? { skip: true, name: holiday.name } : { skip: false };
  }

  /** Nudges groups that have been silent for longer than the configured window. */
  async runInactivityCheck(now: Date = new Date()): Promise<number> {
    const settings = await settingsService.get();
    if (!settings.inactivityEnabled) return 0;

    const hour = localHour(now);
    if (isWithinQuietHours(hour, config.inactivity.quietStart, config.inactivity.quietEnd)) {
      log.debug('Inactivity check skipped (quiet hours)', { hour });
      return 0;
    }

    const groups = await this.deps.groups.list(true);
    let nudged = 0;
    for (const group of groups) {
      const idle = await this.deps.activity.idleHours(group.id);
      if (!Number.isFinite(idle) || idle < settings.inactivityHours) continue;

      // One nudge per idle window per group.
      const windowKey = Math.floor(now.getTime() / (settings.inactivityHours * 3_600_000));
      const queued = await this.deps.messages.send({
        groupId: group.id,
        message: settings.inactivityMessage,
        source: 'inactivity',
        dedupeKey: `inactivity:${group.id}:${windowKey}`,
      });
      if (queued) {
        nudged += 1;
        await audit.info(
          AuditEvent.InactivityNudge,
          { group: group.name, idleHours: Number(idle.toFixed(1)) },
          group.id,
        );
      }
    }
    return nudged;
  }

  /** Sends a random enabled motivational template to every enabled group. */
  async runMotivation(now: Date = new Date()): Promise<number> {
    const settings = await settingsService.get();
    if (!settings.motivationEnabled) return 0;

    const holiday = await this.isHolidayToday();
    if (holiday.skip) {
      await audit.info(AuditEvent.ScheduleSkipped, { job: 'motivation', reason: 'holiday', name: holiday.name });
      return 0;
    }

    const pool = await this.templates.listEnabled('motivation');
    const template = pickRandom(pool);
    if (!template) {
      log.warn('Motivation job skipped — no enabled motivation templates');
      return 0;
    }

    const dateKey = localDateKey(now);
    const groups = await this.deps.groups.list(true);
    let sent = 0;
    for (const group of groups) {
      const queued = await this.deps.messages.send({
        groupId: group.id,
        message: template.body,
        source: 'motivation',
        dedupeKey: `motivation:${group.id}:${dateKey}`,
      });
      if (queued) sent += 1;
    }
    if (sent) await audit.info(AuditEvent.MotivationSent, { template: template.name, groups: sent });
    return sent;
  }

  /** Posts an AI-generated summary of the last 7 days to each enabled group. */
  async runWeeklySummary(now: Date = new Date()): Promise<number> {
    const settings = await settingsService.get();
    if (!settings.aiWeeklySummary) return 0;
    if (!this.deps.ai.isReady || !settings.aiEnabled) {
      await audit.warn(AuditEvent.AiError, { job: 'weekly_summary', reason: 'ai_not_ready' });
      return 0;
    }

    const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const groups = await this.deps.groups.list(true);
    let sent = 0;

    for (const group of groups) {
      try {
        const rows = await this.activityRepo.between(group.id, since, now.toISOString());
        const summary = await this.deps.ai.summarize({
          groupName: group.name,
          periodLabel: `${since.slice(0, 10)} → ${now.toISOString().slice(0, 10)}`,
          messages: rows
            .filter((r) => !r.isFromBot && r.body)
            .map((r) => ({ author: r.authorName ?? 'unknown', body: r.body ?? '', at: r.timestamp.slice(0, 16) })),
        });
        if (!summary) continue;

        const queued = await this.deps.messages.send({
          groupId: group.id,
          message: `Weekly Summary 🧾\n\n${summary}`,
          source: 'ai:summary',
          dedupeKey: `summary:${group.id}:${localDateKey(now)}`,
        });
        if (queued) {
          sent += 1;
          await audit.info(AuditEvent.AiSummary, { group: group.name, chars: summary.length }, group.id);
        }
      } catch (err) {
        await audit.error(AuditEvent.AiError, { job: 'weekly_summary', group: group.name, error: (err as Error).message }, group.id);
      }
    }
    return sent;
  }

  /** Housekeeping: bounded log/activity/outbox growth. */
  async runMaintenance(): Promise<void> {
    await audit.prune();
    await this.deps.schedules.pruneRuns(500);
    await this.outbox.pruneSent(14);
    await this.activityRepo.prune(90);
    log.debug('Maintenance completed');
  }
}
