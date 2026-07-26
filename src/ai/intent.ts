/**
 * Lightweight, deterministic intent detection.
 *
 * Runs before any AI call so the bot stays useful (and cheap) with AI disabled,
 * and so the LLM receives a clear hint about what kind of reply is expected.
 */
export type Intent = 'blocked' | 'waiting' | 'help_request' | 'update' | 'question' | 'other';

interface Rule {
  intent: Intent;
  patterns: RegExp[];
}

const RULES: Rule[] = [
  {
    intent: 'blocked',
    patterns: [/\bblocked?\b/i, /\bblocker(s)?\b/i, /\bstuck\b/i, /can'?t (proceed|continue|move)/i, /\bheld up\b/i],
  },
  {
    intent: 'waiting',
    patterns: [/\bwaiting (on|for)\b/i, /\bpending (on|from)\b/i, /\bawaiting\b/i, /\byet to (receive|get)\b/i, /\bnot (yet )?received\b/i],
  },
  {
    intent: 'help_request',
    patterns: [/\bneed(s)? help\b/i, /\bcan (someone|anyone|somebody)\b/i, /\bany(one|body) (know|free|available)\b/i, /\bplease help\b/i, /\bsupport needed\b/i],
  },
  {
    intent: 'update',
    patterns: [/\b(done|completed|finished|shipped|deployed|merged)\b/i, /\bworking on\b/i, /\bin progress\b/i, /\bupdate:/i],
  },
];

/** Classifies a message body into a coarse intent. */
export function detectIntent(body: string): Intent {
  const text = (body ?? '').trim();
  if (!text) return 'other';
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) return rule.intent;
  }
  if (text.includes('?')) return 'question';
  return 'other';
}

/** Rule-based reply used when AI is unavailable — keeps the bot helpful offline. */
export function fallbackReply(intent: Intent, authorName?: string): string | null {
  const who = authorName ? `${authorName}, ` : '';
  switch (intent) {
    case 'blocked':
      return `Sorry to hear that.\n${who}can you tell everyone what you're blocked on so someone can assist?`;
    case 'waiting':
      return 'Understood.\nWould you like me to remind the group again tomorrow if it still has not arrived?';
    case 'help_request':
      return 'Noted 🙌\nCan someone who knows this area jump in and help?';
    default:
      return null;
  }
}
