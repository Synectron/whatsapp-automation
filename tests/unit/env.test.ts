import { loadEnv, ConfigError } from '../../src/config/env';

const base = {
  NODE_ENV: 'test',
  SESSION_SECRET: 'a-very-long-session-secret-for-testing-1234',
  DASHBOARD_PASSWORD: 'secret',
};

describe('environment validation', () => {
  it('applies defaults for omitted values', () => {
    const env = loadEnv({ ...base } as NodeJS.ProcessEnv);
    expect(env.PORT).toBe(4000);
    expect(env.TIMEZONE).toBe('Asia/Kolkata');
    expect(env.DB_CLIENT).toBe('sqlite');
  });

  it('coerces booleans and numbers', () => {
    const env = loadEnv({ ...base, WHATSAPP_DRY_RUN: 'yes', PORT: '8080' } as NodeJS.ProcessEnv);
    expect(env.WHATSAPP_DRY_RUN).toBe(true);
    expect(env.PORT).toBe(8080);
  });

  it('parses comma-separated lists', () => {
    const env = loadEnv({ ...base, SKIP_WEEKDAYS: '0,6' } as NodeJS.ProcessEnv);
    expect(env.SKIP_WEEKDAYS).toEqual(['0', '6']);
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadEnv({ ...base, PORT: '99999' } as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });

  it('rejects an unknown timezone', () => {
    expect(() => loadEnv({ ...base, TIMEZONE: 'Mars/Olympus' } as NodeJS.ProcessEnv)).toThrow(/time zone/i);
  });

  it('requires a postgres URL when DB_CLIENT=postgres', () => {
    expect(() =>
      loadEnv({ ...base, DB_CLIENT: 'postgres', DATABASE_URL: './data/app.sqlite' } as NodeJS.ProcessEnv),
    ).toThrow(/postgres:\/\//);
  });

  it('requires an API key when AI is enabled', () => {
    expect(() =>
      loadEnv({ ...base, AI_ENABLED: 'true', AI_PROVIDER: 'gemini' } as NodeJS.ProcessEnv),
    ).toThrow(/GEMINI_API_KEY/);
  });

  it('enforces a strong session secret in production', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'production', SESSION_SECRET: 'short' } as NodeJS.ProcessEnv),
    ).toThrow(/SESSION_SECRET/);
  });

  it('rejects invalid weekday exclusions', () => {
    expect(() => loadEnv({ ...base, SKIP_WEEKDAYS: '9' } as NodeJS.ProcessEnv)).toThrow(/weekday/i);
  });
});
