/**
 * Knex configuration. A single source of truth for both the runtime connection
 * and the `knex` CLI (migrations / seeds), for SQLite and PostgreSQL alike.
 */
import path from 'node:path';
import type { Knex } from 'knex';
import { config } from '../config';
import { ensureDir } from '../config/env';

const migrationsDir = path.join(__dirname, 'migrations');
const seedsDir = path.join(__dirname, 'seeds');

export function buildKnexConfig(overrides: Partial<Knex.Config> = {}): Knex.Config {
  const common: Knex.Config = {
    migrations: { directory: migrationsDir, tableName: 'knex_migrations', extension: 'ts', loadExtensions: ['.ts', '.js'] },
    seeds: { directory: seedsDir, loadExtensions: ['.ts', '.js'] },
    asyncStackTraces: !config.isProduction,
  };

  if (config.db.client === 'postgres') {
    return {
      ...common,
      client: 'pg',
      connection: config.db.url,
      pool: { min: config.db.pool.min, max: config.db.pool.max },
      ...overrides,
    };
  }

  // SQLite: make sure the containing folder exists before knex opens the file.
  if (config.db.url !== ':memory:') ensureDir(path.dirname(config.db.url));

  return {
    ...common,
    client: 'better-sqlite3',
    connection: { filename: config.db.url },
    useNullAsDefault: true,
    pool: {
      min: 1,
      max: 1, // SQLite is single-writer; one connection avoids SQLITE_BUSY.
      afterCreate: (conn: { pragma: (s: string) => void }, done: (e?: Error) => void) => {
        try {
          conn.pragma('journal_mode = WAL');
          conn.pragma('foreign_keys = ON');
          conn.pragma('busy_timeout = 5000');
          done();
        } catch (err) {
          done(err as Error);
        }
      },
    },
    ...overrides,
  };
}

/** Default export consumed by the `knex` CLI (migrations / seeds). */
const knexConfig = buildKnexConfig();
export default knexConfig;
