/**
 * Typed, structured application configuration derived from validated env vars.
 * Import `config` anywhere instead of reading `process.env` directly.
 */
import path from 'node:path';
import { Env, loadEnv, resolvePath } from './env';

export type AiProviderName = 'gemini' | 'openai' | 'none';

export interface AppConfig {
  env: Env['NODE_ENV'];
  isProduction: boolean;
  isTest: boolean;
  server: { port: number; host: string; baseUrl: string };
  locale: { timezone: string; locale: string };
  db: {
    client: 'sqlite' | 'postgres';
    url: string;
    pool: { min: number; max: number };
    autoMigrate: boolean;
  };
  auth: {
    username: string;
    password?: string;
    passwordHash?: string;
    sessionSecret: string;
    sessionTtlMs: number;
    secureCookie: boolean;
    apiKey?: string;
  };
  whatsapp: {
    sessionPath: string;
    clientId: string;
    headless: boolean;
    puppeteerArgs: string[];
    executablePath?: string;
    reconnectDelayMs: number;
    maxReconnectAttempts: number;
    dryRun: boolean;
  };
  queue: {
    pollIntervalMs: number;
    maxAttempts: number;
    baseBackoffMs: number;
    maxBackoffMs: number;
    rateLimit: { messages: number; windowMs: number; minGapMs: number };
  };
  scheduler: {
    enabled: boolean;
    holidayAwareness: boolean;
    skipWeekdays: number[];
    motivation: { enabled: boolean; cron: string };
    weeklySummary: { enabled: boolean; cron: string };
  };
  inactivity: {
    enabled: boolean;
    hours: number;
    checkCron: string;
    quietStart: number;
    quietEnd: number;
  };
  ai: {
    provider: AiProviderName;
    enabled: boolean;
    gemini: { apiKey?: string; model: string };
    openai: { apiKey?: string; model: string; baseUrl?: string };
    maxTokens: number;
    temperature: number;
    timeoutMs: number;
    maxRepliesPerHour: number;
    minMessageLength: number;
  };
  contacts: { defaultCountryCode: string };
  logging: {
    level: Env['LOG_LEVEL'];
    dir: string;
    maxFiles: string;
    toConsole: boolean;
    dbRetention: number;
  };
  paths: { root: string; views: string; public: string; backups: string; data: string };
}

/** Builds the structured config object from a validated env bag. */
export function buildConfig(env: Env = loadEnv()): AppConfig {
  const root = process.cwd();
  // Views/static live next to the compiled code: src/ in dev, dist/ after build.
  const assetRoot = path.resolve(__dirname, '..');

  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    server: { port: env.PORT, host: env.HOST, baseUrl: env.BASE_URL },
    locale: { timezone: env.TIMEZONE, locale: env.LOCALE },
    db: {
      client: env.DB_CLIENT,
      url:
        env.DB_CLIENT === 'sqlite' && env.DATABASE_URL !== ':memory:'
          ? resolvePath(env.DATABASE_URL)
          : env.DATABASE_URL,
      pool: { min: env.DB_POOL_MIN, max: env.DB_POOL_MAX },
      autoMigrate: env.DB_AUTO_MIGRATE,
    },
    auth: {
      username: env.DASHBOARD_USERNAME,
      password: env.DASHBOARD_PASSWORD,
      passwordHash: env.DASHBOARD_PASSWORD_HASH,
      sessionSecret: env.SESSION_SECRET,
      sessionTtlMs: env.SESSION_TTL_HOURS * 60 * 60 * 1000,
      secureCookie: env.SESSION_SECURE_COOKIE,
      apiKey: env.API_KEY,
    },
    whatsapp: {
      sessionPath: resolvePath(env.WHATSAPP_SESSION_PATH),
      clientId: env.WHATSAPP_CLIENT_ID,
      headless: env.WHATSAPP_HEADLESS,
      puppeteerArgs: env.WHATSAPP_PUPPETEER_ARGS,
      executablePath: env.WHATSAPP_EXECUTABLE_PATH,
      reconnectDelayMs: env.WHATSAPP_RECONNECT_DELAY_MS,
      maxReconnectAttempts: env.WHATSAPP_MAX_RECONNECT_ATTEMPTS,
      dryRun: env.WHATSAPP_DRY_RUN,
    },
    queue: {
      pollIntervalMs: env.QUEUE_POLL_INTERVAL_MS,
      maxAttempts: env.QUEUE_MAX_ATTEMPTS,
      baseBackoffMs: env.QUEUE_BASE_BACKOFF_MS,
      maxBackoffMs: env.QUEUE_MAX_BACKOFF_MS,
      rateLimit: {
        messages: env.RATE_LIMIT_MESSAGES,
        windowMs: env.RATE_LIMIT_WINDOW_MS,
        minGapMs: env.RATE_LIMIT_MIN_GAP_MS,
      },
    },
    scheduler: {
      enabled: env.SCHEDULER_ENABLED,
      holidayAwareness: env.HOLIDAY_AWARENESS_ENABLED,
      skipWeekdays: env.SKIP_WEEKDAYS.map(Number),
      motivation: { enabled: env.MOTIVATION_ENABLED, cron: env.MOTIVATION_CRON },
      weeklySummary: { enabled: env.AI_WEEKLY_SUMMARY_ENABLED, cron: env.AI_WEEKLY_SUMMARY_CRON },
    },
    inactivity: {
      enabled: env.INACTIVITY_ENABLED,
      hours: env.INACTIVITY_HOURS,
      checkCron: env.INACTIVITY_CHECK_CRON,
      quietStart: env.INACTIVITY_QUIET_START,
      quietEnd: env.INACTIVITY_QUIET_END,
    },
    ai: {
      provider: env.AI_PROVIDER,
      enabled: env.AI_ENABLED,
      gemini: { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL },
      openai: { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL, baseUrl: env.OPENAI_BASE_URL },
      maxTokens: env.AI_MAX_TOKENS,
      temperature: env.AI_TEMPERATURE,
      timeoutMs: env.AI_TIMEOUT_MS,
      maxRepliesPerHour: env.AI_MAX_REPLIES_PER_HOUR,
      minMessageLength: env.AI_MIN_MESSAGE_LENGTH,
    },
    contacts: { defaultCountryCode: env.DEFAULT_COUNTRY_CODE.replace(/\D/g, '') },
    logging: {
      level: env.LOG_LEVEL,
      dir: resolvePath(env.LOG_DIR),
      maxFiles: env.LOG_MAX_FILES,
      toConsole: env.LOG_TO_CONSOLE,
      dbRetention: env.LOG_DB_RETENTION,
    },
    paths: {
      root,
      views: path.join(assetRoot, 'views'),
      public: path.join(assetRoot, 'public'),
      backups: resolvePath(env.BACKUP_DIR),
      data: resolvePath('./data'),
    },
  };
}

export const config: AppConfig = buildConfig();
export { loadEnv, ConfigError } from './env';
export type { Env } from './env';
