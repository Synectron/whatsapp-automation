/** Key/value settings persisted in the database (dashboard-editable). */
import type { Knex } from 'knex';
import { db, nowIso } from '../database';
import { mapSetting } from './mappers';
import type { SettingRecord } from '../models/types';

export class SettingsRepository {
  private readonly injected?: Knex;

  /** `knex` is resolved lazily so tests can swap the connection via setDb(). */
  constructor(knex?: Knex) {
    this.injected = knex;
  }

  private get knex(): Knex {
    return this.injected ?? db();
  }

  private table() {
    return this.knex('settings');
  }

  async all(): Promise<SettingRecord[]> {
    return (await this.table().select('*').orderBy('key')).map(mapSetting);
  }

  async asObject(): Promise<Record<string, string>> {
    const rows = await this.all();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async get(key: string): Promise<string | undefined> {
    const row = await this.table().where({ key }).first();
    return row?.value;
  }

  async getBool(key: string, fallback = false): Promise<boolean> {
    const value = await this.get(key);
    if (value === undefined) return fallback;
    return /^(1|true|yes|on)$/i.test(value);
  }

  async getNumber(key: string, fallback: number): Promise<number> {
    const value = await this.get(key);
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  async set(key: string, value: string): Promise<void> {
    const now = nowIso();
    const existing = await this.table().where({ key }).first();
    if (existing) await this.table().where({ key }).update({ value, updated_at: now });
    else await this.table().insert({ key, value, updated_at: now });
  }

  async setMany(values: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(values)) await this.set(key, value);
  }

  async remove(key: string): Promise<boolean> {
    return (await this.table().where({ key }).delete()) > 0;
  }
}

export const settingsRepository = () => new SettingsRepository();
