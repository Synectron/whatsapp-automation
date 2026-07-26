/**
 * Reacts to inbound group messages: records activity and, when appropriate,
 * posts an AI (or rule-based) follow-up.
 */
import { childLogger } from '../utils/logger';
import { audit, AuditEvent } from './auditService';
import { settingsService } from './settingsService';
import type { ActivityService } from './activityService';
import type { GroupService } from './groupService';
import type { MessageService } from './messageService';
import type { AiService } from '../ai';
import type { InboundMessage } from '../models/types';

const log = childLogger('follow-up');

export class FollowUpService {
  constructor(
    private readonly groups: GroupService,
    private readonly activity: ActivityService,
    private readonly messages: MessageService,
    private readonly ai: AiService,
  ) {}

  /** Entry point wired to the `wa:message` event. */
  async handle(message: InboundMessage): Promise<void> {
    await this.activity.record(message);
    if (message.fromMe) return;

    const group = await this.groups.getByWhatsappId(message.chatId);
    if (!group || !group.enabled) return;

    await audit.record(
      AuditEvent.MessageReceived,
      { group: group.name, author: message.authorName || message.authorId, preview: message.body.slice(0, 120) },
      'debug',
      group.id,
    );

    const settings = await settingsService.get();
    if (!settings.aiAutoReply) return;

    const recent = await this.activity.recent(group.id, 10);
    const result = await this.ai.followUp({
      groupId: group.id,
      groupName: group.name,
      authorName: message.authorName || 'a teammate',
      message: message.body,
      recentMessages: recent
        .slice()
        .reverse()
        .map((a) => ({ author: a.authorName ?? 'unknown', body: a.body ?? '' })),
      persona: settings.aiPersona,
      enabled: settings.aiEnabled,
    });

    if (!result.reply) {
      log.debug('No follow-up generated', { group: group.name, intent: result.intent, reason: result.reason });
      return;
    }

    await this.messages.send({
      groupId: group.id,
      message: `${result.reply}\n\n— Softcoe Bot 🤖`,
      source: `ai:${result.source}`,
      dedupeKey: `followup:${message.messageId}`,
    });

    await audit.info(
      AuditEvent.AiResponse,
      { group: group.name, intent: result.intent, source: result.source, reply: result.reply.slice(0, 200) },
      group.id,
    );
  }
}
