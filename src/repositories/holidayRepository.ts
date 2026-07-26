/** Holiday calendar used to suppress reminders on non-working days. */
import type { Knex } from 'knex';
import { db } from '../database';
import { mapHoliday } from './mappers';
import type { HolidayRecord } from '../models/types';

export class HolidayRepository {
  private readonly injected?: Knex;

  /** `knex` is resolved lazily so tests can swap the connection via setDb(). */
  constructor(knex?: Knex) {
    this.injected = knex;
  }

  private get knex(): Knex {
    return this.injected ?? db();
  }

  private table() {
    return this.knex('holidays');
  }

  async list(): Promise<HolidayRecord[]> {
    return (await this.table().select('*').orderBy('date')).map(mapHoliday);
  }

  async isHoliday(dateKey: string): Promise<HolidayRecord | null> {
    const row = await this.table().where({ date: dateKey, enabled: true }).first();
    return row ? mapHoliday(row) : null;
  }

  async add(date: string, name: string): Promise<HolidayRecord> {
    const existing = await this.table().where({ date }).first();
    if (existing) {
      await this.table().where({ date }).update({ name, enabled: true });
    } else {
      await this.table().insert({ date, name, enabled: true });
    }
    return mapHoliday(await this.table().where({ date }).first());
  }

  async setEnabled(id: number, enabled: boolean): Promise<void> {
    await this.table().where({ id }).update({ enabled });
  }

  async remove(id: number): Promise<boolean> {
    return (await this.table().where({ id }).delete()) > 0;
  }
}

export const holidayRepository = () => new HolidayRepository();
