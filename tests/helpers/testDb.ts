/** Creates an isolated in-memory SQLite database with the full schema applied. */
import path from 'node:path';
import knexFactory, { type Knex } from 'knex';
import { setDb } from '../../src/database';

export async function createTestDb(): Promise<Knex> {
  const knex = knexFactory({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
    migrations: {
      directory: path.resolve(__dirname, '../../src/database/migrations'),
      loadExtensions: ['.ts'],
    },
    seeds: {
      directory: path.resolve(__dirname, '../../src/database/seeds'),
      loadExtensions: ['.ts'],
    },
  });
  await knex.migrate.latest();
  setDb(knex);
  return knex;
}

export async function seedTestDb(knex: Knex): Promise<void> {
  await knex.seed.run();
}

export async function destroyTestDb(knex: Knex): Promise<void> {
  setDb(null);
  await knex.destroy();
}

/** Inserts a group and returns its id. */
export async function insertGroup(
  knex: Knex,
  overrides: Partial<{ whatsapp_id: string; name: string; enabled: boolean }> = {},
): Promise<number> {
  const now = new Date().toISOString();
  const [row] = await knex('groups')
    .insert({
      whatsapp_id: overrides.whatsapp_id ?? '123456789@g.us',
      name: overrides.name ?? 'Test Group',
      enabled: overrides.enabled ?? true,
      created_at: now,
      updated_at: now,
    })
    .returning('id');
  return typeof row === 'object' ? (row as { id: number }).id : (row as number);
}
