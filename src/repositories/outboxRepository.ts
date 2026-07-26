/** Durable outgoing-message queue. Survives restarts and drives retries. */
import type { Knex } from 'knex';
import { db, nowIso } from '../database';
import { mapOutbox } from './mappers';
import type { OutboxRecord, OutboxStatus } from '../models/types';

export interface EnqueueInput {
  groupWhatsappId: string;
  groupId?: number | null;
  body: string;
  mentions?: string[] | null;
  source?: string;
  dedupeKey?: string | null;
  maxAttempts?: number;
  notBefore?: string;
}

export class OutboxRepository {
  private readonly injected?: Knex;

  /** `knex` is resolved lazily so tests can swap the connection via setDb(). */
  constructor(knex?: Knex) {
    this.injected = knex;
  }

  private get knex(): Knex {
    return this.injected ?? db();
  }

  private table() {
    return this.knex('outbox');
  }

  /**
   * Adds a message to the queue. When `dedupeKey` collides with an existing row
   * the enqueue is a no-op and `null` is returned — this is the second layer of
   * duplicate protection (the first being schedule run claims).
   */
  async enqueue(input: EnqueueInput): Promise<OutboxRecord | null> {
    if (input.dedupeKey) {
      const existing = await this.table().where({ dedupe_key: input.dedupeKey }).first();
      if (existing) return null;
    }
    const now = nowIso();
    try {
      const [row] = await this.table()
        .insert({
          group_whatsapp_id: input.groupWhatsappId,
          group_id: input.groupId ?? null,
          body: input.body,
          mentions: input.mentions?.length ? JSON.stringify(input.mentions) : null,
          status: 'pending' as OutboxStatus,
          attempts: 0,
          max_attempts: input.maxAttempts ?? 5,
          next_attempt_at: input.notBefore ?? now,
          source: input.source ?? 'manual',
          dedupe_key: input.dedupeKey ?? null,
          created_at: now,
        })
        .returning('id');
      const id = typeof row === 'object' ? (row as { id: number }).id : (row as number);
      return await this.findById(id);
    } catch (err) {
      // Unique violation on dedupe_key from a concurrent enqueue.
      if (input.dedupeKey) return null;
      throw err;
    }
  }

  async findById(id: number): Promise<OutboxRecord | null> {
    const row = await this.table().where({ id }).first();
    return row ? mapOutbox(row) : null;
  }

  /** Messages that are due for a delivery attempt. */
  async claimBatch(limit = 5): Promise<OutboxRecord[]> {
    const now = nowIso();
    const rows = await this.table()
      .where({ status: 'pending' })
      .andWhere('next_attempt_at', '<=', now)
      .orderBy('id', 'asc')
      .limit(limit);

    const claimed: OutboxRecord[] = [];
    for (const row of rows) {
      const updated = await this.table()
        .where({ id: row.id, status: 'pending' })
        .update({ status: 'sending', attempts: row.attempts + 1 });
      if (updated === 1) claimed.push(mapOutbox({ ...row, status: 'sending', attempts: row.attempts + 1 }));
    }
    return claimed;
  }

  async markSent(id: number): Promise<void> {
    await this.table().where({ id }).update({ status: 'sent', sent_at: nowIso(), last_error: null });
  }

  async markRetry(id: number, error: string, nextAttemptAt: string): Promise<void> {
    await this.table().where({ id }).update({ status: 'pending', last_error: error, next_attempt_at: nextAttemptAt });
  }

  async markFailed(id: number, error: string): Promise<void> {
    await this.table().where({ id }).update({ status: 'failed', last_error: error });
  }

  /** Re-queues rows stuck in `sending` (e.g. after a hard crash). */
  async requeueStale(olderThanMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    return this.table()
      .where({ status: 'sending' })
      .andWhere('created_at', '<=', cutoff)
      .update({ status: 'pending', next_attempt_at: nowIso() });
  }

  async retryFailed(id?: number): Promise<number> {
    const query = this.table().where({ status: 'failed' });
    if (id !== undefined) query.andWhere({ id });
    return query.update({ status: 'pending', attempts: 0, next_attempt_at: nowIso(), last_error: null });
  }

  async cancel(id: number): Promise<boolean> {
    return (await this.table().whereIn('status', ['pending', 'failed']).andWhere({ id }).update({ status: 'cancelled' })) > 0;
  }

  async list(status?: OutboxStatus, limit = 100): Promise<OutboxRecord[]> {
    const query = this.table().select('*').orderBy('id', 'desc').limit(limit);
    if (status) query.where({ status });
    return (await query).map(mapOutbox);
  }

  async stats(): Promise<{ pending: number; failed: number; sentLastHour: number }> {
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const [pending] = await this.table().where({ status: 'pending' }).count<{ c: string | number }[]>({ c: '*' });
    const [failed] = await this.table().where({ status: 'failed' }).count<{ c: string | number }[]>({ c: '*' });
    const [sent] = await this.table()
      .where({ status: 'sent' })
      .andWhere('sent_at', '>=', hourAgo)
      .count<{ c: string | number }[]>({ c: '*' });
    return {
      pending: Number(pending?.c ?? 0),
      failed: Number(failed?.c ?? 0),
      sentLastHour: Number(sent?.c ?? 0),
    };
  }

  /** Removes delivered rows older than `days` to keep the table small. */
  async pruneSent(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    return this.table().where({ status: 'sent' }).andWhere('sent_at', '<', cutoff).delete();
  }
}

export const outboxRepository = () => new OutboxRepository();
