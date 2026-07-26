/**
 * Runtime-mutable configuration.
 *
 * A handful of settings (timezone, locale) must be changeable from the setup
 * wizard and the dashboard without a redeploy. They are seeded from the
 * environment at boot and overridden from the `settings` table once loaded.
 * Everything else stays immutable in {@link config}.
 */
import { config } from './index';
import { childLogger } from '../utils/logger';

const log = childLogger('runtime-config');

interface RuntimeState {
  timezone: string;
  locale: string;
}

const state: RuntimeState = {
  timezone: config.locale.timezone,
  locale: config.locale.locale,
};

/** IANA timezone used for cron evaluation, date keys and display. */
export const getTimezone = (): string => state.timezone;

/** BCP-47 locale used for date/time formatting. */
export const getLocale = (): string => state.locale;

/** Validates and applies a timezone. Returns false when the zone is unknown. */
export function setTimezone(timezone: string): boolean {
  if (!isValidTimezone(timezone)) {
    log.warn('Ignored invalid timezone', { timezone });
    return false;
  }
  state.timezone = timezone;
  log.info('Runtime timezone updated', { timezone });
  return true;
}

export function setLocale(locale: string): boolean {
  try {
    new Intl.DateTimeFormat(locale);
  } catch {
    log.warn('Ignored invalid locale', { locale });
    return false;
  }
  state.locale = locale;
  return true;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** A short, curated list for the setup wizard's dropdown. */
export const COMMON_TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Lisbon',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Africa/Lagos',
  'Africa/Nairobi',
  'UTC',
] as const;

/** Restores persisted overrides at boot. */
export function hydrateRuntimeConfig(values: Record<string, string | undefined>): void {
  if (values['app.timezone']) setTimezone(values['app.timezone']);
  if (values['app.locale']) setLocale(values['app.locale']);
}

/** Test helper — restores the environment-derived defaults. */
export function resetRuntimeConfig(): void {
  state.timezone = config.locale.timezone;
  state.locale = config.locale.locale;
}
