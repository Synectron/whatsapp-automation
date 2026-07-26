/**
 * Environment loading + validation.
 *
 * Every tunable in the application is sourced from here — there are no hardcoded
 * values elsewhere in the codebase. Validation happens once, at boot, and the
 * process refuses to start when the configuration is unusable.
 */
import path from 'node:path';
import fs from 'node:fs';
import dotenvx from '@dotenvx/dotenvx';
import { z } from 'zod';

// dotenvx transparently decrypts the encrypted .env using the private key
// from .env.keys (or the DOTENV_PRIVATE_KEY environment variable in prod).
dotenvx.config({ quiet: true });

/** Coerce common truthy strings to a boolean. */
const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? def : /^(1|true|yes|on)$/i.test(v.trim())));

/** Coerce a numeric string with a default and range validation. */
const num = (def: number, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? def : Number(v)))
    .refine((v) => Number.isFinite(v) && v >= min && v <= max, {
      message: `expected a number between ${min} and ${max}`,
    });

/** Non-empty string with default. */
const str = (def: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? def : v.trim()));

/** Optional string that stays undefined when blank. */
const optStr = () =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const csv = (def: string[] = []) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v.trim() === ''
        ? def
        : v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    );

/** Fallback used when SESSION_SECRET is unset — rejected in production. */
export const SESSION_SECRET_DEFAULT = 'development-only-secret-change-me-please-32chars';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: num(4000, 1, 65535),
  HOST: str('0.0.0.0'),
  BASE_URL: str('http://localhost:4000'),

  TIMEZONE: str('Asia/Kolkata'),
  LOCALE: str('en-IN'),

  DB_CLIENT: z.enum(['sqlite', 'postgres']).default('sqlite'),
  DATABASE_URL: str('./data/app.sqlite'),
  DB_POOL_MIN: num(1, 0, 100),
  DB_POOL_MAX: num(10, 1, 500),
  DB_AUTO_MIGRATE: bool(true),

  DASHBOARD_USERNAME: str('admin'),
  DASHBOARD_PASSWORD: optStr(),
  DASHBOARD_PASSWORD_HASH: optStr(),
  SESSION_SECRET: str(SESSION_SECRET_DEFAULT),
  SESSION_TTL_HOURS: num(12, 1, 24 * 30),
  SESSION_SECURE_COOKIE: bool(false),
  API_KEY: optStr(),

  WHATSAPP_SESSION_PATH: str('./data/wwebjs_auth'),
  WHATSAPP_CLIENT_ID: str('default'),
  WHATSAPP_HEADLESS: bool(true),
  WHATSAPP_PUPPETEER_ARGS: csv(['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']),
  WHATSAPP_EXECUTABLE_PATH: optStr(),
  WHATSAPP_RECONNECT_DELAY_MS: num(5000, 500, 600000),
  WHATSAPP_MAX_RECONNECT_ATTEMPTS: num(20, 0, 1000),
  WHATSAPP_DRY_RUN: bool(false),

  QUEUE_POLL_INTERVAL_MS: num(2000, 250, 120000),
  QUEUE_MAX_ATTEMPTS: num(5, 1, 50),
  QUEUE_BASE_BACKOFF_MS: num(5000, 100, 3600000),
  QUEUE_MAX_BACKOFF_MS: num(900000, 1000, 86400000),
  RATE_LIMIT_MESSAGES: num(20, 1, 10000),
  RATE_LIMIT_WINDOW_MS: num(60000, 1000, 3600000),
  RATE_LIMIT_MIN_GAP_MS: num(1500, 0, 600000),

  SCHEDULER_ENABLED: bool(true),
  HOLIDAY_AWARENESS_ENABLED: bool(true),
  SKIP_WEEKDAYS: csv([]),

  INACTIVITY_ENABLED: bool(true),
  INACTIVITY_HOURS: num(6, 1, 24 * 14),
  INACTIVITY_CHECK_CRON: str('0 * * * *'),
  INACTIVITY_QUIET_START: num(22, 0, 23),
  INACTIVITY_QUIET_END: num(8, 0, 23),

  MOTIVATION_ENABLED: bool(false),
  MOTIVATION_CRON: str('0 9 * * 1-5'),

  AI_PROVIDER: z.enum(['gemini', 'openai', 'none']).default('gemini'),
  AI_ENABLED: bool(false),
  GEMINI_API_KEY: optStr(),
  GEMINI_MODEL: str('gemini-flash-latest'),
  OPENAI_API_KEY: optStr(),
  OPENAI_MODEL: str('gpt-4o-mini'),
  OPENAI_BASE_URL: optStr(),
  AI_MAX_TOKENS: num(400, 32, 8192),
  AI_TEMPERATURE: num(0.4, 0, 2),
  AI_TIMEOUT_MS: num(20000, 1000, 300000),
  AI_MAX_REPLIES_PER_HOUR: num(6, 0, 500),
  AI_MIN_MESSAGE_LENGTH: num(8, 1, 1000),
  AI_WEEKLY_SUMMARY_ENABLED: bool(false),
  AI_WEEKLY_SUMMARY_CRON: str('0 17 * * 5'),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug', 'silly']).default('info'),
  LOG_DIR: str('./logs'),
  LOG_MAX_FILES: str('14d'),
  LOG_TO_CONSOLE: bool(true),
  LOG_DB_RETENTION: num(5000, 100, 10_000_000),

  BACKUP_DIR: str('./backups'),
});

export type Env = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Parses `process.env` and applies cross-field rules that zod cannot express
 * on its own. Throws {@link ConfigError} with a human-readable report.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new ConfigError(`Invalid environment configuration:\n${details}`);
  }
  const env = parsed.data;
  const problems: string[] = [];

  if (env.NODE_ENV === 'production') {
    if (env.SESSION_SECRET.length < 32) {
      problems.push('SESSION_SECRET must be at least 32 characters in production.');
    }
    // An unset SESSION_SECRET falls back to a published default — session
    // cookies would be forgeable by anyone who has read this repository.
    if (env.SESSION_SECRET === SESSION_SECRET_DEFAULT) {
      problems.push(
        'SESSION_SECRET is unset and fell back to the built-in development value. ' +
          'Generate one with: openssl rand -hex 32',
      );
    }
    if (env.DASHBOARD_PASSWORD && env.DASHBOARD_PASSWORD === 'change-me-please') {
      problems.push('DASHBOARD_PASSWORD is still the example value.');
    }
    // No password is legitimate: the first-boot wizard creates the account in
    // the database. It does mean the instance is unclaimed until someone
    // completes it, so make that loud rather than fatal.
    if (!env.DASHBOARD_PASSWORD && !env.DASHBOARD_PASSWORD_HASH) {
      // eslint-disable-next-line no-console
      console.warn(
        '[config] No DASHBOARD_PASSWORD set — the first-boot setup wizard will be reachable to ' +
          'anyone who can open this URL until you complete it. Finish setup immediately after deploying, ' +
          'or set DASHBOARD_PASSWORD to skip the wizard.',
      );
    }
  }

  if (env.DB_CLIENT === 'postgres' && !/^postgres(ql)?:\/\//i.test(env.DATABASE_URL)) {
    problems.push('DB_CLIENT=postgres requires DATABASE_URL to be a postgres:// connection string.');
  }

  if (env.AI_ENABLED && env.AI_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) {
    problems.push('AI_ENABLED=true with AI_PROVIDER=gemini requires GEMINI_API_KEY.');
  }
  if (env.AI_ENABLED && env.AI_PROVIDER === 'openai' && !env.OPENAI_API_KEY) {
    problems.push('AI_ENABLED=true with AI_PROVIDER=openai requires OPENAI_API_KEY.');
  }

  if (env.QUEUE_MAX_BACKOFF_MS < env.QUEUE_BASE_BACKOFF_MS) {
    problems.push('QUEUE_MAX_BACKOFF_MS must be >= QUEUE_BASE_BACKOFF_MS.');
  }

  for (const day of env.SKIP_WEEKDAYS) {
    if (!/^[0-6]$/.test(day)) problems.push(`SKIP_WEEKDAYS contains an invalid weekday: "${day}".`);
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: env.TIMEZONE });
  } catch {
    problems.push(`TIMEZONE "${env.TIMEZONE}" is not a valid IANA time zone.`);
  }

  if (problems.length) {
    throw new ConfigError(`Invalid environment configuration:\n${problems.map((p) => `  • ${p}`).join('\n')}`);
  }

  return env;
}

/** Resolves a possibly-relative path against the project root. */
export function resolvePath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

/** Creates a directory (recursively) if it does not already exist. */
export function ensureDir(p: string): string {
  const abs = resolvePath(p);
  if (!fs.existsSync(abs)) fs.mkdirSync(abs, { recursive: true });
  return abs;
}
