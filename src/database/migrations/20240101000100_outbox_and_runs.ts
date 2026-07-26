/**
 * Durable outgoing message queue (`outbox`) and scheduled-run bookkeeping
 * (`schedule_runs`) which guarantees a schedule fires at most once per slot,
 * even across restarts or overlapping workers.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('outbox', (t) => {
    t.increments('id').primary();
    t.string('group_whatsapp_id', 128).notNullable();
    t.integer('group_id').unsigned().nullable().references('id').inTable('groups').onDelete('SET NULL');
    t.text('body').notNullable();
    t.text('mentions').nullable();
    t.string('status', 16).notNullable().defaultTo('pending');
    t.integer('attempts').notNullable().defaultTo(0);
    t.integer('max_attempts').notNullable().defaultTo(5);
    t.string('next_attempt_at', 40).notNullable();
    t.text('last_error').nullable();
    t.string('source', 48).notNullable().defaultTo('manual');
    t.string('dedupe_key', 200).nullable().unique();
    t.string('created_at', 40).notNullable();
    t.string('sent_at', 40).nullable();
    t.index(['status', 'next_attempt_at'], 'idx_outbox_ready');
  });

  await knex.schema.createTable('schedule_runs', (t) => {
    t.increments('id').primary();
    t.integer('schedule_id').unsigned().notNullable().references('id').inTable('schedules').onDelete('CASCADE');
    t.string('fire_key', 40).notNullable();
    t.string('status', 24).notNullable().defaultTo('queued');
    t.text('detail').nullable();
    t.string('created_at', 40).notNullable();
    t.unique(['schedule_id', 'fire_key'], { indexName: 'uq_schedule_runs' });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('schedule_runs');
  await knex.schema.dropTableIfExists('outbox');
}
