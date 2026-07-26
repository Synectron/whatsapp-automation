/**
 * Records inbound/outbound group messages and answers "how quiet is it?"
 * questions for the inactivity watcher and the analytics pages.
 */
import { childLogger } from '../utils/logger';
import { ActivityRepository } from '../repositories/activityRepository';
import type { GroupService } from './groupService';
import type { InboundMessage } from '../models/types';

const log = childLogger('activity-service');

export class ActivityService {
  constructor(
    private readonly groups: GroupService,
    private readonly repo: ActivityRepository = new ActivityRepository(),
  ) {}

  /** Persists a group message; unknown groups are ignored (not yet synced). */
  async record(message: InboundMessage): Promise<void> {
    const group = await this.groups.getByWhatsappId(message.chatId);
    if (!group) {
      log.debug('Activity for unknown group ignored', { chatId: message.chatId });
      return;
    }
    await this.repo.record({
      groupId: group.id,
      whatsappId: message.chatId,
      authorId: message.authorId,
      authorName: message.authorName,
      messageId: message.messageId,
      body: message.body,
      isFromBot: message.fromMe,
      timestamp: message.timestamp,
    });
    if (!message.fromMe) await this.groups.touchLastMessage(message.chatId, message.timestamp);
  }

  lastHumanMessageAt: ActivityRepository['lastHumanMessageAt'] = (...args) =>
    this.repo.lastHumanMessageAt(...args);
  recent: ActivityRepository['recent'] = (...args) => this.repo.recent(...args);
  between: ActivityRepository['between'] = (...args) => this.repo.between(...args);
  countSince: ActivityRepository['countSince'] = (...args) => this.repo.countSince(...args);
  topContributors: ActivityRepository['topContributors'] = (...args) =>
    this.repo.topContributors(...args);
  dailyCounts: ActivityRepository['dailyCounts'] = (...args) => this.repo.dailyCounts(...args);

  /** Hours since the last human message; Infinity when the group never spoke. */
  async idleHours(groupId: number): Promise<number> {
    const last = await this.repo.lastHumanMessageAt(groupId);
    if (!last) return Number.POSITIVE_INFINITY;
    return (Date.now() - new Date(last).getTime()) / 3_600_000;
  }
}
