/**
 * Initial schema: groups, schedules, logs, settings.
 * Portable across SQLite and PostgreSQL (timestamps stored as ISO-8601 text).
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('groups', (t) => {
    t.increments('id').primary();
    t.string('whatsapp_id', 128).notNullable().unique();
    t.string('name', 255).notNullable();
    t.boolean('enabled').notNullable().defaultTo(false);
    t.text('description').nullable();
    t.integer('participant_count').nullable();
    t.string('last_message_at', 40).nullable();
    t.string('last_reminder_at', 40).nullable();
    t.text('metadata').nullable();
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.index(['enabled'], 'idx_groups_enabled');
  });

  await knex.schema.createTable('schedules', (t) => {
    t.increments('id').primary();
    t.integer('group_id').unsigned().notNullable().references('id').inTable('groups').onDelete('CASCADE');
    t.string('name', 160).notNullable();
    t.string('kind', 32).notNullable().defaultTo('reminder');
    t.string('cron', 120).notNullable();
    t.text('message').notNullable();
    t.integer('template_id').unsigned().nullable();
    t.string('timezone', 64).nullable();
    t.boolean('enabled').notNullable().defaultTo(true);
    t.boolean('mention_all').notNullable().defaultTo(false);
    t.boolean('skip_holidays').notNullable().defaultTo(true);
    t.boolean('run_once').notNullable().defaultTo(false);
    t.string('last_run_at', 40).nullable();
    t.string('next_run_hint', 40).nullable();
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.index(['group_id'], 'idx_schedules_group');
    t.index(['enabled'], 'idx_schedules_enabled');
  });

  await knex.schema.createTable('logs', (t) => {
    t.increments('id').primary();
    t.string('timestamp', 40).notNullable();
    t.string('level', 16).notNullable().defaultTo('info');
    t.string('event', 64).notNullable();
    t.text('details').nullable();
    t.integer('group_id').unsigned().nullable().references('id').inTable('groups').onDelete('SET NULL');
    t.index(['timestamp'], 'idx_logs_timestamp');
    t.index(['event'], 'idx_logs_event');
    t.index(['level'], 'idx_logs_level');
  });

  await knex.schema.createTable('settings', (t) => {
    t.string('key', 120).primary();
    t.text('value').notNullable();
    t.string('updated_at', 40).notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('settings');
  await knex.schema.dropTableIfExists('logs');
  await knex.schema.dropTableIfExists('schedules');
  await knex.schema.dropTableIfExists('groups');
}
