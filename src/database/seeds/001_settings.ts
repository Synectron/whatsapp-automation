/** Default runtime settings (overridable from the dashboard). */
import type { Knex } from 'knex';
import { config } from '../../config';

export async function seed(knex: Knex): Promise<void> {
  const now = new Date().toISOString();
  const defaults: Record<string, string> = {
    'ai.enabled': String(config.ai.enabled),
    'ai.provider': config.ai.provider,
    'ai.persona':
      'You are a concise, friendly project coordinator in a WhatsApp work group. ' +
      'Reply in at most three short lines. Never invent facts. Encourage people to unblock each other.',
    'ai.autoReply': 'true',
    'ai.weeklySummary': String(config.scheduler.weeklySummary.enabled),
    'inactivity.enabled': String(config.inactivity.enabled),
    'inactivity.hours': String(config.inactivity.hours),
    'inactivity.message':
      'Hey everyone 👋\nJust checking in.\nDoes anyone need help?\nAny updates to share?',
    'motivation.enabled': String(config.scheduler.motivation.enabled),
    'scheduler.enabled': String(config.scheduler.enabled),
    'branding.signature': '',
  };

  for (const [key, value] of Object.entries(defaults)) {
    const existing = await knex('settings').where({ key }).first();
    if (!existing) await knex('settings').insert({ key, value, updated_at: now });
  }
}
