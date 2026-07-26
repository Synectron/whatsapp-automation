/** Per-message group activity: powers inactivity detection and analytics. */
import type { Knex } from 'knex';
import { db, nowIso } from '../database';
import { mapActivity } from './mappers';
import type { ActivityRecord } from '../models/types';

export interface ActivityInput {
  groupId: number;
  whatsappId: string;
  authorId?: string | null;
  authorName?: string | null;
  messageId?: string | null;
  body?: string | null;
  isFromBot?: boolean;
  timestamp?: string;
}

export interface ContributorStat {
  authorId: string;
  authorName: string;
  messages: number;
}

export class ActivityRepository {
  private readonly injected?: Knex;

  /** `knex` is resolved lazily so tests can swap the connection via setDb(). */
  constructor(knex?: Knex) {
    this.injected = knex;
  }

  private get knex(): Knex {
    return this.injected ?? db();
  }

  private table() {
    return this.knex('group_activity');
  }

  async record(input: ActivityInput): Promise<void> {
    await this.table().insert({
      group_id: input.groupId,
      whatsapp_id: input.whatsappId,
      author_id: input.authorId ?? null,
      author_name: input.authorName ?? null,
      message_id: input.messageId ?? null,
      body: input.body ? input.body.slice(0, 4000) : null,
      is_from_bot: input.isFromBot ?? false,
      timestamp: input.timestamp ?? nowIso(),
    });
  }

  /** Most recent human message timestamp for a group (bot messages ignored). */
  async lastHumanMessageAt(groupId: number): Promise<string | null> {
    const row = await this.table()
      .where({ group_id: groupId, is_from_bot: false })
      .orderBy('timestamp', 'desc')
      .first();
    return row?.timestamp ?? null;
  }

  async recent(groupId: number, limit = 50): Promise<ActivityRecord[]> {
    return (await this.table().where({ group_id: groupId }).orderBy('id', 'desc').limit(limit)).map(mapActivity);
  }

  /** Messages in a window, oldest first — used to build AI weekly summaries. */
  async between(groupId: number, since: string, until: string = nowIso()): Promise<ActivityRecord[]> {
    return (
      await this.table()
        .where({ group_id: groupId })
        .andWhere('timestamp', '>=', since)
        .andWhere('timestamp', '<=', until)
        .orderBy('timestamp', 'asc')
    ).map(mapActivity);
  }

  async countSince(groupId: number, since: string): Promise<number> {
    const [row] = await this.table()
      .where({ group_id: groupId })
      .andWhere('timestamp', '>=', since)
      .count<{ c: string | number }[]>({ c: '*' });
    return Number(row?.c ?? 0);
  }

  async topContributors(groupId: number, since: string, limit = 10): Promise<ContributorStat[]> {
    const rows = await this.table()
      .where({ group_id: groupId, is_from_bot: false })
      .andWhere('timestamp', '>=', since)
      .whereNotNull('author_id')
      .groupBy('author_id', 'author_name')
      .select('author_id', 'author_name')
      .count<{ author_id: string; author_name: string; c: string | number }[]>({ c: '*' })
      .orderBy('c', 'desc')
      .limit(limit);
    return rows.map((r) => ({
      authorId: r.author_id,
      authorName: r.author_name ?? r.author_id,
      messages: Number(r.c),
    }));
  }

  /** Message counts bucketed by local date (YYYY-MM-DD) for charts. */
  async dailyCounts(groupId: number, since: string): Promise<Array<{ date: string; messages: number }>> {
    const rows = await this.table()
      .where({ group_id: groupId })
      .andWhere('timestamp', '>=', since)
      .select('timestamp');
    const buckets = new Map<string, number>();
    for (const row of rows as Array<{ timestamp: string }>) {
      const date = row.timestamp.slice(0, 10);
      buckets.set(date, (buckets.get(date) ?? 0) + 1);
    }
    return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, messages]) => ({ date, messages }));
  }

  async prune(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    return this.table().where('timestamp', '<', cutoff).delete();
  }
}

export const activityRepository = () => new ActivityRepository();
