/**
 * Sample holiday calendar (India, 2026) — edit or replace from the dashboard.
 * Reminders whose `skip_holidays` flag is set are suppressed on these dates.
 */
import type { Knex } from 'knex';

const HOLIDAYS: Array<{ date: string; name: string }> = [
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-01-26', name: 'Republic Day' },
  { date: '2026-03-04', name: 'Holi' },
  { date: '2026-05-01', name: 'Labour Day' },
  { date: '2026-08-15', name: 'Independence Day' },
  { date: '2026-10-02', name: 'Gandhi Jayanti' },
  { date: '2026-11-08', name: 'Diwali' },
  { date: '2026-12-25', name: 'Christmas Day' },
];

export async function seed(knex: Knex): Promise<void> {
  for (const holiday of HOLIDAYS) {
    const existing = await knex('holidays').where({ date: holiday.date }).first();
    if (!existing) await knex('holidays').insert({ ...holiday, enabled: true });
  }
}
