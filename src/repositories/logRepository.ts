/** Data access for the application audit log. */
import type { Knex } from 'knex';
import { db, nowIso } from '../database';
import { mapLog } from './mappers';
import type { LogLevel, LogRecord } from '../models/types';

export interface LogQuery {
  limit?: number;
  offset?: number;
  level?: LogLevel;
  event?: string;
  groupId?: number;
  since?: string;
  search?: string;
}

export class LogRepository {
  private readonly injected?: Knex;

  /** `knex` is resolved lazily so tests can swap the connection via setDb(). */
  constructor(knex?: Knex) {
    this.injected = knex;
  }

  private get knex(): Knex {
    return this.injected ?? db();
  }

  private table() {
    return this.knex('logs');
  }

  async add(event: string, details?: unknown, level: LogLevel = 'info', groupId?: number | null): Promise<LogRecord> {
    const payload =
      details === undefined || details === null
        ? null
        : typeof details === 'string'
          ? details
          : JSON.stringify(details);
    const [row] = await this.table()
      .insert({ timestamp: nowIso(), level, event, details: payload, group_id: groupId ?? null })
      .returning('id');
    const id = typeof row === 'object' ? (row as { id: number }).id : (row as number);
    return (await this.findById(id))!;
  }

  async findById(id: number): Promise<LogRecord | null> {
    const row = await this.table().where({ id }).first();
    return row ? mapLog(row) : null;
  }

  async query(options: LogQuery = {}): Promise<{ items: LogRecord[]; total: number }> {
    const { limit = 100, offset = 0 } = options;
    const base = this.table();
    const applyFilters = (q: Knex.QueryBuilder) => {
      if (options.level) q.where('level', options.level);
      if (options.event) q.where('event', options.event);
      if (options.groupId !== undefined) q.where('group_id', options.groupId);
      if (options.since) q.where('timestamp', '>=', options.since);
      if (options.search) q.where('details', 'like', `%${options.search}%`);
      return q;
    };

    const items = await applyFilters(base.clone())
      .select('*')
      .orderBy('id', 'desc')
      .limit(Math.min(limit, 1000))
      .offset(offset);

    const countRow = await applyFilters(this.table().clone()).count<{ count: string | number }[]>({ count: '*' });
    const total = Number(countRow[0]?.count ?? 0);
    return { items: items.map(mapLog), total };
  }

  async distinctEvents(): Promise<string[]> {
    const rows = await this.table().distinct('event').orderBy('event');
    return rows.map((r: { event: string }) => r.event);
  }

  /** Keeps the table bounded; returns the number of rows removed. */
  async prune(retention: number): Promise<number> {
    const rows = await this.table().select('id').orderBy('id', 'desc').offset(retention).limit(100000);
    if (!rows.length) return 0;
    return this.table()
      .whereIn('id', rows.map((r: { id: number }) => r.id))
      .delete();
  }

  async clear(): Promise<number> {
    return this.table().delete();
  }
}

export const logRepository = () => new LogRepository();
