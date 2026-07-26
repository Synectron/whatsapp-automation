/** Data access for reminder schedules and their per-slot run records. */
import type { Knex } from 'knex';
import { db, nowIso } from '../database';
import { mapSchedule } from './mappers';
import type { ScheduleKind, ScheduleRecord } from '../models/types';

export interface ScheduleInput {
  groupId: number;
  name: string;
  cron: string;
  message: string;
  kind?: ScheduleKind;
  templateId?: number | null;
  timezone?: string | null;
  enabled?: boolean;
  mentionAll?: boolean;
  skipHolidays?: boolean;
  runOnce?: boolean;
}

export class ScheduleRepository {
  private readonly injected?: Knex;

  /** `knex` is resolved lazily so tests can swap the connection via setDb(). */
  constructor(knex?: Knex) {
    this.injected = knex;
  }

  private get knex(): Knex {
    return this.injected ?? db();
  }

  private table() {
    return this.knex('schedules');
  }

  async list(filter: { groupId?: number; enabledOnly?: boolean } = {}): Promise<ScheduleRecord[]> {
    const query = this.table().select('*').orderBy('id', 'asc');
    if (filter.groupId !== undefined) query.where({ group_id: filter.groupId });
    if (filter.enabledOnly) query.where({ enabled: true });
    return (await query).map(mapSchedule);
  }

  /** Enabled schedules whose group is also enabled — the scheduler's work list. */
  async listActive(): Promise<ScheduleRecord[]> {
    const rows = await this.knex('schedules')
      .join('groups', 'groups.id', 'schedules.group_id')
      .where('schedules.enabled', true)
      .andWhere('groups.enabled', true)
      .select('schedules.*');
    return rows.map(mapSchedule);
  }

  async findById(id: number): Promise<ScheduleRecord | null> {
    const row = await this.table().where({ id }).first();
    return row ? mapSchedule(row) : null;
  }

  async create(input: ScheduleInput): Promise<ScheduleRecord> {
    const now = nowIso();
    const [row] = await this.table()
      .insert({
        group_id: input.groupId,
        name: input.name,
        kind: input.kind ?? 'reminder',
        cron: input.cron,
        message: input.message,
        template_id: input.templateId ?? null,
        timezone: input.timezone ?? null,
        enabled: input.enabled ?? true,
        mention_all: input.mentionAll ?? false,
        skip_holidays: input.skipHolidays ?? true,
        run_once: input.runOnce ?? false,
        created_at: now,
        updated_at: now,
      })
      .returning('id');
    const id = typeof row === 'object' ? (row as { id: number }).id : (row as number);
    return (await this.findById(id))!;
  }

  async update(id: number, patch: Partial<ScheduleInput>): Promise<ScheduleRecord | null> {
    const payload: Record<string, unknown> = { updated_at: nowIso() };
    if (patch.groupId !== undefined) payload.group_id = patch.groupId;
    if (patch.name !== undefined) payload.name = patch.name;
    if (patch.kind !== undefined) payload.kind = patch.kind;
    if (patch.cron !== undefined) payload.cron = patch.cron;
    if (patch.message !== undefined) payload.message = patch.message;
    if (patch.templateId !== undefined) payload.template_id = patch.templateId;
    if (patch.timezone !== undefined) payload.timezone = patch.timezone;
    if (patch.enabled !== undefined) payload.enabled = patch.enabled;
    if (patch.mentionAll !== undefined) payload.mention_all = patch.mentionAll;
    if (patch.skipHolidays !== undefined) payload.skip_holidays = patch.skipHolidays;
    if (patch.runOnce !== undefined) payload.run_once = patch.runOnce;
    await this.table().where({ id }).update(payload);
    return this.findById(id);
  }

  async markRun(id: number, at: string = nowIso()): Promise<void> {
    await this.table().where({ id }).update({ last_run_at: at, updated_at: at });
  }

  async remove(id: number): Promise<boolean> {
    return (await this.table().where({ id }).delete()) > 0;
  }

  /**
   * Claims a fire slot for a schedule. Returns false when the slot was already
   * claimed — this is what makes duplicate scheduled messages impossible even
   * if two workers (or a restart) trigger the same minute.
   */
  async claimRun(scheduleId: number, fireKey: string): Promise<boolean> {
    try {
      await this.knex('schedule_runs').insert({
        schedule_id: scheduleId,
        fire_key: fireKey,
        status: 'queued',
        created_at: nowIso(),
      });
      return true;
    } catch {
      return false; // unique constraint violation → already claimed
    }
  }

  async completeRun(scheduleId: number, fireKey: string, status: string, detail?: string): Promise<void> {
    await this.knex('schedule_runs').where({ schedule_id: scheduleId, fire_key: fireKey }).update({ status, detail: detail ?? null });
  }

  /** Trims run history to the most recent `keep` rows per schedule. */
  async pruneRuns(keep = 200): Promise<number> {
    const ids = await this.knex('schedule_runs')
      .select('id')
      .orderBy('id', 'desc')
      .offset(keep)
      .limit(100_000);
    if (!ids.length) return 0;
    return this.knex('schedule_runs')
      .whereIn('id', ids.map((r: { id: number }) => r.id))
      .delete();
  }
}

export const scheduleRepository = () => new ScheduleRepository();
