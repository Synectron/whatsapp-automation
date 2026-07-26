/**
 * Reusable message templates, per-message group activity (analytics + inactivity
 * detection) and a holiday calendar.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('templates', (t) => {
    t.increments('id').primary();
    t.string('name', 160).notNullable().unique();
    t.string('category', 48).notNullable().defaultTo('general');
    t.text('body').notNullable();
    t.boolean('enabled').notNullable().defaultTo(true);
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.index(['category'], 'idx_templates_category');
  });

  await knex.schema.createTable('group_activity', (t) => {
    t.increments('id').primary();
    t.integer('group_id').unsigned().notNullable().references('id').inTable('groups').onDelete('CASCADE');
    t.string('whatsapp_id', 128).notNullable();
    t.string('author_id', 128).nullable();
    t.string('author_name', 160).nullable();
    t.string('message_id', 190).nullable();
    t.text('body').nullable();
    t.boolean('is_from_bot').notNullable().defaultTo(false);
    t.string('timestamp', 40).notNullable();
    t.index(['group_id', 'timestamp'], 'idx_activity_group_ts');
    t.index(['author_id'], 'idx_activity_author');
  });

  await knex.schema.createTable('holidays', (t) => {
    t.increments('id').primary();
    t.string('date', 10).notNullable().unique(); // YYYY-MM-DD
    t.string('name', 160).notNullable();
    t.boolean('enabled').notNullable().defaultTo(true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('holidays');
  await knex.schema.dropTableIfExists('group_activity');
  await knex.schema.dropTableIfExists('templates');
}
