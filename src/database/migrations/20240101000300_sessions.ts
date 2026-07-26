/** Persistent dashboard sessions (survive restarts, work on SQLite + Postgres). */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('sessions', (t) => {
    t.string('sid', 128).primary();
    t.text('data').notNullable();
    t.string('expires_at', 40).notNullable();
    t.index(['expires_at'], 'idx_sessions_expires');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('sessions');
}
