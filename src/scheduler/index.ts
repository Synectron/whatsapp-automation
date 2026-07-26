/**
 * Cron orchestration.
 *
 * Every enabled schedule (whose group is also enabled) gets a node-cron task in
 * the configured timezone. Firing is idempotent: a slot is claimed in
 * `schedule_runs` and the resulting message carries a dedupe key, so a restart
 * or an overlapping tick can never double-post.
 */
import cron, { type ScheduledTask } from 'node-cron';
import { config } from '../config';
import { getTimezone } from '../config/runtime';
import { childLogger } from '../utils/logger';
import { minuteKey, localWeekday } from '../utils/time';
import { validateCron } from '../utils/cron';
import { audit, AuditEvent } from '../services/auditService';
import { settingsService } from '../services/settingsService';
import { SystemJobs, type JobDeps } from './jobs';
import type { ScheduleRecord } from '../models/types';

const log = childLogger('scheduler');

export interface SchedulerDeps extends JobDeps {
  /** Overridable clock for deterministic tests. */
  now?: () => Date;
}

export class SchedulerService {
  private readonly tasks = new Map<string, ScheduledTask>();
  private readonly jobs: SystemJobs;
  private readonly now: () => Date;
  private started = false;

  constructor(private readonly deps: SchedulerDeps) {
    this.jobs = new SystemJobs(deps);
    this.now = deps.now ?? (() => new Date());
  }

  public get activeJobCount(): number {
    return this.tasks.size;
  }

  public get isRunning(): boolean {
    return this.started;
  }

  /** Starts system jobs and loads every user schedule. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.registerSystemJobs();
    await this.reload();
    // Keep cron jobs in sync with schedule CRUD.
    this.deps.schedules.onChange(() => this.reload());
    log.info('Scheduler started', { jobs: this.tasks.size, timezone: getTimezone() });
  }

  stop(): void {
    for (const [key, task] of this.tasks) {
      task.stop();
      log.debug('Cron task stopped', { key });
    }
    this.tasks.clear();
    this.started = false;
    log.info('Scheduler stopped');
  }

  private schedule(key: string, expression: string, handler: () => Promise<void>): void {
    const validation = validateCron(expression);
    if (!validation.valid || !validation.normalized) {
      log.error('Refusing to register invalid cron expression', { key, expression, reason: validation.reason });
      return;
    }
    const task = cron.schedule(
      validation.normalized,
      () => {
        void handler().catch((err) =>
          log.error('Cron handler failed', { key, error: (err as Error).message }),
        );
      },
      { scheduled: true, timezone: getTimezone() },
    );
    this.tasks.set(key, task);
  }

  private registerSystemJobs(): void {
    if (config.inactivity.enabled) {
      this.schedule('system:inactivity', config.inactivity.checkCron, async () => {
        const nudged = await this.jobs.runInactivityCheck(this.now());
        if (nudged) log.info('Inactivity nudges queued', { groups: nudged });
      });
    }

    this.schedule('system:motivation', config.scheduler.motivation.cron, async () => {
      const sent = await this.jobs.runMotivation(this.now());
      if (sent) log.info('Motivation messages queued', { groups: sent });
    });

    this.schedule('system:weekly-summary', config.scheduler.weeklySummary.cron, async () => {
      const sent = await this.jobs.runWeeklySummary(this.now());
      if (sent) log.info('Weekly summaries queued', { groups: sent });
    });

    // Housekeeping at 03:15 local time.
    this.schedule('system:maintenance', '15 3 * * *', () => this.jobs.runMaintenance());
  }

  /** Rebuilds all user-schedule cron tasks from the database. */
  async reload(): Promise<number> {
    for (const [key, task] of this.tasks) {
      if (key.startsWith('schedule:')) {
        task.stop();
        this.tasks.delete(key);
      }
    }

    const schedules = await this.deps.schedules.listActive();
    for (const schedule of schedules) {
      this.schedule(`schedule:${schedule.id}`, schedule.cron, () => this.fire(schedule.id));
    }
    log.info('Schedules reloaded', { count: schedules.length });
    return schedules.length;
  }

  /**
   * Executes one schedule occurrence. Exported for the dashboard's
   * "Run now" button and for tests.
   */
  async fire(scheduleId: number, options: { manual?: boolean } = {}): Promise<'queued' | 'skipped' | 'duplicate'> {
    const schedule = await this.deps.schedules.get(scheduleId);
    const now = this.now();

    const settings = await settingsService.get();
    if (!options.manual && !settings.schedulerEnabled) {
      await this.skip(schedule, 'scheduler_disabled');
      return 'skipped';
    }

    if (!options.manual && config.scheduler.skipWeekdays.includes(localWeekday(now))) {
      await this.skip(schedule, 'weekday_excluded');
      return 'skipped';
    }

    if (!options.manual && schedule.skipHolidays) {
      const holiday = await this.jobs.isHolidayToday();
      if (holiday.skip) {
        await this.skip(schedule, `holiday:${holiday.name}`);
        return 'skipped';
      }
    }

    // Slot claim — the primary duplicate guard.
    const fireKey = options.manual ? `manual:${now.toISOString()}` : minuteKey(now);
    const claimed = await this.deps.schedules.claimRun(schedule.id, fireKey);
    if (!claimed) {
      log.debug('Schedule slot already claimed', { scheduleId, fireKey });
      return 'duplicate';
    }

    const queued = await this.deps.messages.send({
      groupId: schedule.groupId,
      message: schedule.message,
      mentionAll: schedule.mentionAll,
      source: `schedule:${schedule.id}`,
      dedupeKey: `schedule:${schedule.id}:${fireKey}`,
      force: options.manual,
      vars: { schedule: schedule.name },
    });

    await this.deps.schedules.markRun(schedule.id, now.toISOString());
    await this.deps.groups.touchLastReminder(schedule.groupId, now.toISOString());
    await this.deps.schedules.completeRun(schedule.id, fireKey, queued ? 'queued' : 'suppressed');

    await audit.info(
      AuditEvent.ScheduleFired,
      { scheduleId: schedule.id, name: schedule.name, manual: Boolean(options.manual), queued: Boolean(queued) },
      schedule.groupId,
    );

    // One-shot schedules (meeting reminders) disable themselves after firing.
    if (schedule.runOnce && !options.manual) {
      await this.deps.schedules.update(schedule.id, { enabled: false });
    }

    return queued ? 'queued' : 'skipped';
  }

  private async skip(schedule: ScheduleRecord, reason: string): Promise<void> {
    await audit.info(
      AuditEvent.ScheduleSkipped,
      { scheduleId: schedule.id, name: schedule.name, reason },
      schedule.groupId,
    );
    log.info('Schedule skipped', { scheduleId: schedule.id, reason });
  }

  /** Direct access to system jobs (dashboard "run now" actions). */
  public get systemJobs(): SystemJobs {
    return this.jobs;
  }
}

export * from './jobs';
