/**
 * Knex-backed express-session store.
 *
 * Written in-house (rather than pulling another dependency) so it behaves
 * identically on SQLite and PostgreSQL and so expiry/cleanup semantics are
 * explicit and testable.
 */
import { Store, type SessionData } from 'express-session';
import type { Knex } from 'knex';
import { db, nowIso } from '../database';
import { childLogger } from '../utils/logger';

const log = childLogger('session-store');

export interface KnexSessionStoreOptions {
  knex?: Knex;
  /** Sweep interval for expired rows. */
  cleanupIntervalMs?: number;
  defaultTtlMs: number;
}

export class KnexSessionStore extends Store {
  private readonly knex: Knex;
  private readonly defaultTtlMs: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: KnexSessionStoreOptions) {
    super();
    this.knex = options.knex ?? db();
    this.defaultTtlMs = options.defaultTtlMs;
    const interval = options.cleanupIntervalMs ?? 15 * 60 * 1000;
    this.timer = setInterval(() => void this.sweep(), interval);
    this.timer.unref?.();
  }

  private table() {
    return this.knex('sessions');
  }

  private expiryFor(session: SessionData): string {
    const cookieExpires = session.cookie?.expires;
    if (cookieExpires) return new Date(cookieExpires).toISOString();
    return new Date(Date.now() + this.defaultTtlMs).toISOString();
  }

  override get(sid: string, callback: (err?: unknown, session?: SessionData | null) => void): void {
    void (async () => {
      try {
        const row = await this.table().where({ sid }).first();
        if (!row) return callback(null, null);
        if (row.expires_at <= nowIso()) {
          await this.table().where({ sid }).delete();
          return callback(null, null);
        }
        callback(null, JSON.parse(row.data) as SessionData);
      } catch (err) {
        callback(err);
      }
    })();
  }

  override set(sid: string, session: SessionData, callback?: (err?: unknown) => void): void {
    void (async () => {
      try {
        const payload = { sid, data: JSON.stringify(session), expires_at: this.expiryFor(session) };
        const existing = await this.table().where({ sid }).first();
        if (existing) await this.table().where({ sid }).update(payload);
        else await this.table().insert(payload);
        callback?.();
      } catch (err) {
        callback?.(err);
      }
    })();
  }

  override destroy(sid: string, callback?: (err?: unknown) => void): void {
    void this.table()
      .where({ sid })
      .delete()
      .then(() => callback?.())
      .catch((err) => callback?.(err));
  }

  override touch(sid: string, session: SessionData, callback?: () => void): void {
    void this.table()
      .where({ sid })
      .update({ expires_at: this.expiryFor(session) })
      .then(() => callback?.())
      .catch(() => callback?.());
  }

  /** Deletes expired rows. */
  async sweep(): Promise<number> {
    try {
      const removed = await this.table().where('expires_at', '<=', nowIso()).delete();
      if (removed) log.debug('Expired sessions removed', { removed });
      return removed;
    } catch (err) {
      log.warn('Session sweep failed', { error: (err as Error).message });
      return 0;
    }
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
