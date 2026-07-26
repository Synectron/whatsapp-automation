/** Timezone-aware date helpers built on Intl (no moment/dayjs dependency). */
import { getLocale, getTimezone } from '../config/runtime';

const partsOf = (date: Date, timeZone: string) => {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return out;
};

/** `YYYY-MM-DD` for the given instant in the configured timezone. */
export function localDateKey(date: Date = new Date(), timeZone = getTimezone()): string {
  const p = partsOf(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Local hour (0-23) in the configured timezone. */
export function localHour(date: Date = new Date(), timeZone = getTimezone()): number {
  return Number(partsOf(date, timeZone).hour);
}

/** Local weekday index, 0 = Sunday. */
export function localWeekday(date: Date = new Date(), timeZone = getTimezone()): number {
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[partsOf(date, timeZone).weekday ?? 'Sun'] ?? 0;
}

/** `YYYY-MM-DDTHH:mm` — the natural dedupe key for a per-minute cron fire. */
export function minuteKey(date: Date = new Date(), timeZone = getTimezone()): string {
  const p = partsOf(date, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Human-readable timestamp in the configured locale + timezone. */
export function formatLocal(date: Date | string | number, timeZone = getTimezone()): string {
  const d = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat(getLocale(), {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(d);
}

/** True when `hour` falls inside a wrap-around quiet window (e.g. 22 → 8). */
export function isWithinQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export const hoursToMs = (h: number) => h * 60 * 60 * 1000;
