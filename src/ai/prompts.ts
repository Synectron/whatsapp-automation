/** Prompt templates. Kept in one file so tone can be tuned without code changes. */

export const DEFAULT_PERSONA =
  'You are Softcoe Bot, an AI assistant acting as a friendly project coordinator in a WhatsApp work group. ' +
  'Be transparent that you are an AI bot: never pretend to be a human team member, and if asked, say so plainly. ' +
  'Reply in plain text, no markdown headings. ' +
  'Never invent facts or commitments. Encourage teammates to unblock each other. ' +
  'If nothing useful can be added, reply with exactly: SKIP';

export interface FollowUpContext {
  groupName: string;
  authorName: string;
  message: string;
  recentMessages: Array<{ author: string; body: string }>;
  intent: string;
}

export function buildFollowUpPrompt(ctx: FollowUpContext): string {
  const history = ctx.recentMessages
    .slice(-8)
    .map((m) => `${m.author}: ${m.body}`)
    .join('\n');

  return [
    `Group: ${ctx.groupName}`,
    `Detected intent: ${ctx.intent}`,
    '',
    'Recent conversation:',
    history || '(no earlier messages)',
    '',
    `New message from ${ctx.authorName}:`,
    ctx.message,
    '',
    'Write the coordinator follow-up. Guidance by intent:',
    '- blocked: acknowledge briefly, then ask them to state exactly what they are blocked on so someone can assist.',
    '- waiting: acknowledge, then offer to remind the group again tomorrow if it has not arrived.',
    '- help_request: invite the relevant person to jump in and suggest a next step.',
    '- update: acknowledge in one line; do not ask unnecessary questions.',
    '- other: reply only if it clearly helps, otherwise output SKIP.',
  ].join('\n');
}

export interface SummaryContext {
  groupName: string;
  periodLabel: string;
  messages: Array<{ author: string; body: string; at: string }>;
}

export const SUMMARY_PERSONA =
  'You summarise a work group chat for a team lead. Be factual, specific and brief. ' +
  'Use plain text with short bullet lines. Do not invent anything that is not in the transcript.';

export function buildSummaryPrompt(ctx: SummaryContext): string {
  const transcript = ctx.messages.map((m) => `[${m.at}] ${m.author}: ${m.body}`).join('\n');
  return [
    `Group: ${ctx.groupName}`,
    `Period: ${ctx.periodLabel}`,
    '',
    'Transcript:',
    transcript || '(no messages in this period)',
    '',
    'Produce a summary with these sections, each with 0-5 short bullets:',
    'Completed',
    'In progress',
    'Blockers',
    'Risks / needs attention',
    '',
    'If the transcript is empty, reply with exactly: NO_ACTIVITY',
  ].join('\n');
}
