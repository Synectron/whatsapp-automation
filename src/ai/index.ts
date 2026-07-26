/**
 * AI facade: provider selection, anti-spam guards, follow-up replies and
 * weekly summaries. Everything degrades gracefully when AI is off.
 */
import { config } from '../config';
import { childLogger } from '../utils/logger';
import { GeminiProvider } from './geminiProvider';
import { OpenAiProvider } from './openaiProvider';
import { NoopProvider } from './noopProvider';
import { buildFollowUpPrompt, buildSummaryPrompt, DEFAULT_PERSONA, SUMMARY_PERSONA } from './prompts';
import { detectIntent, fallbackReply, type Intent } from './intent';
import type { AiProvider } from './provider';

const log = childLogger('ai');

export interface FollowUpInput {
  groupId: number;
  groupName: string;
  authorName: string;
  message: string;
  recentMessages: Array<{ author: string; body: string }>;
  persona?: string;
  enabled: boolean;
}

export interface FollowUpResult {
  reply: string | null;
  intent: Intent;
  source: 'ai' | 'rules' | 'none';
  reason?: string;
}

/** Builds the provider named in configuration. */
export function createProvider(name: string = config.ai.provider): AiProvider {
  switch (name) {
    case 'gemini': {
      const provider = new GeminiProvider();
      return provider.isReady ? provider : new NoopProvider();
    }
    case 'openai': {
      const provider = new OpenAiProvider();
      return provider.isReady ? provider : new NoopProvider();
    }
    default:
      return new NoopProvider();
  }
}

export class AiService {
  private provider: AiProvider;
  /** groupId → timestamps of AI replies inside the trailing hour. */
  private readonly recentReplies = new Map<number, number[]>();

  constructor(provider: AiProvider = createProvider()) {
    this.provider = provider;
  }

  public get providerName(): string {
    return this.provider.name;
  }

  public get isReady(): boolean {
    return this.provider.isReady;
  }

  /** Swaps the provider at runtime (dashboard AI settings). */
  public useProvider(name: string): void {
    this.provider = createProvider(name);
    log.info('AI provider switched', { provider: this.provider.name, ready: this.provider.isReady });
  }

  /** Per-group hourly cap so the bot never turns into a chat participant. */
  private underReplyQuota(groupId: number): boolean {
    const cap = config.ai.maxRepliesPerHour;
    if (cap <= 0) return false;
    const cutoff = Date.now() - 3_600_000;
    const stamps = (this.recentReplies.get(groupId) ?? []).filter((t) => t > cutoff);
    this.recentReplies.set(groupId, stamps);
    return stamps.length < cap;
  }

  private noteReply(groupId: number): void {
    const stamps = this.recentReplies.get(groupId) ?? [];
    stamps.push(Date.now());
    this.recentReplies.set(groupId, stamps);
  }

  /**
   * Produces a follow-up for an inbound group message.
   * Falls back to deterministic replies when AI is unavailable, and returns
   * `null` when the bot should stay quiet.
   */
  async followUp(input: FollowUpInput): Promise<FollowUpResult> {
    const intent = detectIntent(input.message);

    if (input.message.trim().length < config.ai.minMessageLength) {
      return { reply: null, intent, source: 'none', reason: 'message_too_short' };
    }
    if (!this.underReplyQuota(input.groupId)) {
      return { reply: null, intent, source: 'none', reason: 'hourly_quota_reached' };
    }

    if (!input.enabled || !this.provider.isReady) {
      const reply = fallbackReply(intent, input.authorName);
      if (reply) this.noteReply(input.groupId);
      return { reply, intent, source: reply ? 'rules' : 'none', reason: reply ? undefined : 'no_rule_matched' };
    }

    try {
      const raw = await this.provider.complete({
        system: input.persona?.trim() || DEFAULT_PERSONA,
        user: buildFollowUpPrompt({
          groupName: input.groupName,
          authorName: input.authorName,
          message: input.message,
          recentMessages: input.recentMessages,
          intent,
        }),
      });
      const reply = raw.trim();
      if (!reply || /^skip$/i.test(reply)) {
        // The model declined, but someone explicitly asked for something —
        // acknowledge instead of leaving them on read.
        const needsAck: Intent[] = ['blocked', 'waiting', 'help_request', 'question'];
        if (needsAck.includes(intent)) {
          const generic = `Thanks for reaching out 🙏 We've noted this and will get back to you shortly.`;
          this.noteReply(input.groupId);
          return { reply: generic, intent, source: 'rules', reason: 'model_declined_ack' };
        }
        return { reply: null, intent, source: 'none', reason: 'model_declined' };
      }
      this.noteReply(input.groupId);
      return { reply, intent, source: 'ai' };
    } catch (err) {
      log.warn('AI follow-up failed, using rule-based reply', { error: (err as Error).message });
      const reply = fallbackReply(intent, input.authorName);
      if (reply) this.noteReply(input.groupId);
      return { reply, intent, source: reply ? 'rules' : 'none', reason: (err as Error).message };
    }
  }

  /** Generates a weekly summary; returns null when there is nothing to report. */
  async summarize(input: {
    groupName: string;
    periodLabel: string;
    messages: Array<{ author: string; body: string; at: string }>;
  }): Promise<string | null> {
    if (!this.provider.isReady) throw new Error('AI provider is not configured.');
    if (!input.messages.length) return null;
    const raw = await this.provider.complete({
      system: SUMMARY_PERSONA,
      user: buildSummaryPrompt(input),
      maxTokens: Math.max(config.ai.maxTokens, 600),
      temperature: 0.2,
    });
    const text = raw.trim();
    return !text || /^no_activity$/i.test(text) ? null : text;
  }
}

export const aiService = new AiService();
export * from './provider';
export * from './intent';
export * from './prompts';
