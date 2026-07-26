/**
 * Cron helpers: validation plus a human-readable description used by the
 * dashboard and the API responses.
 */
import cron from 'node-cron';

export interface CronValidationResult {
  valid: boolean;
  reason?: string;
  normalized?: string;
}

const NAMED = new Set(['@yearly', '@annually', '@monthly', '@weekly', '@daily', '@midnight', '@hourly']);

/**
 * Validates a cron expression against node-cron's parser.
 * Accepts 5-field (standard) and 6-field (with seconds) expressions.
 */
export function validateCron(expression: string): CronValidationResult {
  if (typeof expression !== 'string' || !expression.trim()) {
    return { valid: false, reason: 'Cron expression is required.' };
  }
  const normalized = expression.trim().replace(/\s+/g, ' ');
  if (NAMED.has(normalized.toLowerCase())) {
    return { valid: false, reason: 'Named schedules (@daily) are not supported — use 5-field cron syntax.' };
  }
  const fields = normalized.split(' ').length;
  if (fields !== 5 && fields !== 6) {
    return { valid: false, reason: `Expected 5 or 6 fields, received ${fields}.` };
  }
  if (!cron.validate(normalized)) {
    return { valid: false, reason: 'Not a valid cron expression.' };
  }
  return { valid: true, normalized };
}

/** Throwing variant used at service boundaries. */
export function assertValidCron(expression: string): string {
  const result = validateCron(expression);
  if (!result.valid || !result.normalized) {
    throw new Error(result.reason ?? 'Invalid cron expression');
  }
  return result.normalized;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Best-effort English description of common cron patterns. */
export function describeCron(expression: string): string {
  const result = validateCron(expression);
  if (!result.valid || !result.normalized) return 'Invalid schedule';
  const parts = result.normalized.split(' ');
  const [minute, hour, dom, month, dow] = parts.length === 6 ? parts.slice(1) : parts;

  const time =
    /^\d+$/.test(minute) && /^\d+$/.test(hour)
      ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      : null;

  if (dom === '*' && month === '*' && dow === '*' && time) return `Every day at ${time}`;
  if (dom === '*' && month === '*' && time && /^[0-6]$/.test(dow)) {
    return `Every ${DAYS[Number(dow)]} at ${time}`;
  }
  if (dom === '*' && month === '*' && time && /^[0-6]-[0-6]$/.test(dow)) {
    const [a, b] = dow.split('-').map(Number);
    return `${DAYS[a]}–${DAYS[b]} at ${time}`;
  }
  if (dom === '*' && month === '*' && time && dow.includes(',')) {
    const names = dow.split(',').map((d) => DAYS[Number(d)] ?? d);
    return `${names.join(', ')} at ${time}`;
  }
  if (minute === '0' && hour === '*') return 'Every hour, on the hour';
  if (/^\*\/(\d+)$/.test(minute) && hour === '*') {
    return `Every ${minute.split('/')[1]} minutes`;
  }
  return `Cron: ${result.normalized}`;
}
