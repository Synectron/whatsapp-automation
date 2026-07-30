/**
 * The single entry point for anything the bot says.
 *
 * Every caller (scheduler, dashboard, AI, inactivity watcher) goes through
 * here so rate limiting, deduplication, mentions, signatures and audit logging
 * are applied uniformly.
 */
import { config } from '../config';
import { getLocale, getTimezone } from '../config/runtime';
import { isChatId, isIndividualChatId, parsePhoneNumber, PhoneNumberError } from '../utils/phone';
import { renderTemplate, type TemplateVars } from '../utils/templating';
import { ValidationError } from '../utils/errors';
import { audit, AuditEvent } from './auditService';
import { settingsService } from './settingsService';
import type { GroupService } from './groupService';
import type { MessageQueue } from '../whatsapp/messageQueue';
import type { WhatsAppGateway } from '../whatsapp/gateway';
import type { GroupRecord, OutboxRecord } from '../models/types';

export interface SendRequest {
  /** Numeric group id, or the raw WhatsApp chat id (…@g.us). */
  groupId?: number;
  whatsappId?: string;
  /**
   * An individual recipient's phone number in any readable format. Resolved
   * against WhatsApp before the message is queued.
   */
  phone?: string;
  message: string;
  /** Template placeholders such as {{group}} / {{date}}. */
  vars?: TemplateVars;
  /** @-mention every stored participant. */
  mentionAll?: boolean;
  /** Explicit participant ids to mention. */
  mentions?: string[];
  source?: string;
  dedupeKey?: string;
  /** Bypass the `enabled` flag (used for explicit manual sends). */
  force?: boolean;
}

export const MAX_MESSAGE_LENGTH = 4096;

export class MessageService {
  constructor(
    private readonly queue: MessageQueue,
    private readonly groups: GroupService,
    private readonly gateway?: WhatsAppGateway,
  ) {}

  /**
   * Turns a typed phone number into a chat id, confirming the number actually
   * has a WhatsApp account first.
   */
  private async resolvePhone(phone: string): Promise<string> {
    let parsed;
    try {
      parsed = parsePhoneNumber(phone);
    } catch (err) {
      if (err instanceof PhoneNumberError) throw new ValidationError(err.message, { field: 'phone' });
      throw err;
    }

    if (!this.gateway) return parsed.chatId;

    const resolved = await this.gateway.resolveNumber(parsed.digits);
    if (!resolved.registered) {
      throw new ValidationError(`${parsed.display} does not have a WhatsApp account.`, { field: 'phone' });
    }
    return resolved.chatId;
  }

  /** Resolves a request to a stored group, when one exists. */
  private async resolveGroup(request: SendRequest): Promise<GroupRecord | null> {
    if (request.groupId !== undefined) return this.groups.getById(request.groupId);
    if (request.whatsappId) return this.groups.getByWhatsappId(request.whatsappId);
    return null;
  }

  /**
   * Renders, validates and queues a message.
   * Returns `null` when the send was intentionally suppressed (disabled group
   * or duplicate dedupe key).
   */
  async send(request: SendRequest): Promise<OutboxRecord | null> {
    if (!request.message?.trim()) throw new ValidationError('Message body cannot be empty.');

    const group = await this.resolveGroup(request);
    const chatId =
      group?.whatsappId ?? request.whatsappId ?? (request.phone ? await this.resolvePhone(request.phone) : undefined);
    if (!chatId) throw new ValidationError('Provide a groupId, whatsappId or phone number.');
    // Shape check only, deliberately not an allow-list of suffixes. WhatsApp is
    // migrating individual contacts from `<number>@c.us` to LID addressing
    // (`<id>@lid`), and getNumberId already returns the new form — an allow-list
    // rejects valid ids the moment the vendor adds one. Let WhatsApp be the
    // authority on which ids it accepts; we only guard against obvious rubbish.
    if (!isChatId(chatId)) {
      throw new ValidationError(
        `"${chatId}" is not a WhatsApp chat id. Expected something like 12345@c.us, 12345@lid or 12345@g.us.`,
      );
    }
    if (group && !group.enabled && !request.force) {
      await audit.warn(AuditEvent.ScheduleSkipped, { reason: 'group_disabled', group: group.name }, group.id);
      return null;
    }

    const isDirectMessage = isIndividualChatId(chatId);

    const settings = await settingsService.get();
    const vars: TemplateVars = {
      group: group?.name ?? '',
      date: new Date().toLocaleDateString(getLocale(), { timeZone: getTimezone() }),
      time: new Date().toLocaleTimeString(getLocale(), { timeZone: getTimezone() }),
      ...request.vars,
    };

    let body = renderTemplate(request.message, vars).trim();
    if (settings.signature) body = `${body}\n\n${settings.signature}`;
    if (body.length > MAX_MESSAGE_LENGTH) body = `${body.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;

    const mentions = request.mentions?.length
      ? request.mentions
      : request.mentionAll && group
        ? await this.groups.participantIds(group.id)
        : undefined;

    const record = await this.queue.enqueue({
      groupWhatsappId: chatId,
      groupId: group?.id ?? null,
      body,
      mentions: mentions ?? null,
      source: request.source ?? 'manual',
      dedupeKey: request.dedupeKey ?? null,
    });

    if (record) {
      await audit.info(
        AuditEvent.MessageQueued,
        {
          outboxId: record.id,
          recipient: group?.name ?? chatId,
          type: isDirectMessage ? 'direct' : 'group',
          source: record.source,
        },
        group?.id ?? null,
      );
    }
    return record;
  }

  /** Fan-out helper for manual broadcasts to every enabled group. */
  async broadcast(message: string, options: Omit<SendRequest, 'message' | 'groupId' | 'whatsappId'> = {}) {
    const groups = await this.groups.list(true);
    const results: Array<{ groupId: number; name: string; queued: boolean }> = [];
    for (const group of groups) {
      const record = await this.send({
        ...options,
        groupId: group.id,
        message,
        source: options.source ?? 'broadcast',
        dedupeKey: options.dedupeKey ? `${options.dedupeKey}:${group.id}` : undefined,
      });
      results.push({ groupId: group.id, name: group.name, queued: Boolean(record) });
    }
    return results;
  }
}
