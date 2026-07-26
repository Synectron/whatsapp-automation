/**
 * Database bootstrap: connection lifecycle, migrations, seeds and small
 * dialect-portability helpers.
 */
import knexFactory, { Knex } from 'knex';
import { buildKnexConfig } from './knexfile';
import { config } from '../config';
import { childLogger } from '../utils/logger';

const log = childLogger('database');

let instance: Knex | null = null;

/** Returns the shared knex instance, creating it on first use. */
export function db(): Knex {
  if (!instance) {
    instance = knexFactory(buildKnexConfig());
    log.info('Database connection created', { client: config.db.client });
  }
  return instance;
}

/** Replaces the shared instance — used by tests to inject an in-memory DB. */
export function setDb(next: Knex | null): void {
  instance = next;
}

/** Applies all pending migrations. */
export async function runMigrations(target: Knex = db()): Promise<string[]> {
  const [batch, applied] = (await target.migrate.latest()) as [number, string[]];
  if (applied.length) log.info('Migrations applied', { batch, applied });
  else log.debug('Database schema already up to date');
  return applied;
}

/** Runs seed files (idempotent — seeds use upserts). */
export async function runSeeds(target: Knex = db()): Promise<void> {
  await target.seed.run();
  log.info('Seed data applied');
}

/** Verifies connectivity with a trivial query. */
export async function healthcheck(target: Knex = db()): Promise<boolean> {
  try {
    await target.raw('select 1 as ok');
    return true;
  } catch (err) {
    log.error('Database healthcheck failed', { error: (err as Error).message });
    return false;
  }
}

export async function closeDb(): Promise<void> {
  if (instance) {
    await instance.destroy();
    instance = null;
    log.info('Database connection closed');
  }
}

/** `true` when running on SQLite — used for dialect-specific SQL. */
export const isSqlite = (target: Knex = db()): boolean =>
  target.client.config.client.includes('sqlite');

/** ISO-8601 UTC timestamp, the storage format for every date column. */
export const nowIso = (): string => new Date().toISOString();

/** SQLite has no boolean type; normalise 0/1/'true' into a real boolean. */
export const toBool = (value: unknown): boolean =>
  value === true || value === 1 || value === '1' || value === 'true';

/** Safe JSON parse for TEXT columns holding JSON. */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}
