/** Starter message templates: reminders, meetings and motivation. */
import type { Knex } from 'knex';

const TEMPLATES: Array<{ name: string; category: string; body: string }> = [
  {
    name: 'Daily morning check-in',
    category: 'reminder',
    body:
      'Good morning everyone 👋\n\nQuick check-in:\n' +
      '• What are you working on today?\n' +
      '• Any blockers?\n' +
      '• Does anyone need help?\n\n' +
      'Reply here so everyone stays aligned.',
  },
  {
    name: 'Monday planning',
    category: 'reminder',
    body:
      'Monday Planning 🗓️\n\n' +
      '• What are your top 3 priorities this week?\n' +
      '• Anything that needs a decision from the team?\n' +
      '• Any dependencies on someone else?\n\n' +
      'Drop your plan below.',
  },
  {
    name: 'Friday wrap-up',
    category: 'reminder',
    body:
      'Weekly Check-in 📅\n\n' +
      '• What was completed?\n' +
      "• What's pending?\n" +
      '• Any risks?\n' +
      '• Need help before next week?',
  },
  {
    name: 'Meeting reminder (30 min)',
    category: 'meeting',
    body: 'Reminder ⏰\n\n{{meeting}} starts in {{minutes}} minutes.\nPlease join on time.',
  },
  {
    name: 'Sprint planning reminder',
    category: 'meeting',
    body: 'Reminder ⏰\n\nSprint planning starts in 30 minutes.\nPlease join on time.',
  },
  {
    name: 'Inactivity nudge',
    category: 'inactivity',
    body: 'Hey everyone 👋\nJust checking in.\nDoes anyone need help?\nAny updates to share?',
  },
  {
    name: 'Motivation — progress',
    category: 'motivation',
    body: 'Small steps still move the project forward. Pick one thing today and finish it 💪',
  },
  {
    name: 'Motivation — teamwork',
    category: 'motivation',
    body: 'If you are stuck for more than an hour, ask. The team is faster together 🤝',
  },
  {
    name: 'Motivation — focus',
    category: 'motivation',
    body: 'Protect one deep-work block today. Notifications can wait ⏳',
  },
  {
    name: 'Motivation — momentum',
    category: 'motivation',
    body: 'Yesterday is feedback, today is leverage. Have a good one ☀️',
  },
];

export async function seed(knex: Knex): Promise<void> {
  const now = new Date().toISOString();
  for (const tpl of TEMPLATES) {
    const existing = await knex('templates').where({ name: tpl.name }).first();
    if (!existing) {
      await knex('templates').insert({ ...tpl, enabled: true, created_at: now, updated_at: now });
    }
  }
}
