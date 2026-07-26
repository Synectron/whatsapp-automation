/** Group activity analytics and CSV export. */
import { ActivityRepository } from '../repositories/activityRepository';
import { GroupRepository } from '../repositories/groupRepository';
import { NotFoundError } from '../utils/errors';

export interface GroupStats {
  groupId: number;
  name: string;
  windowDays: number;
  totalMessages: number;
  humanMessages: number;
  botMessages: number;
  activeContributors: number;
  topContributors: Array<{ authorId: string; authorName: string; messages: number }>;
  daily: Array<{ date: string; messages: number }>;
  lastMessageAt: string | null;
  idleHours: number | null;
}

export class AnalyticsService {
  constructor(
    private readonly activity: ActivityRepository = new ActivityRepository(),
    private readonly groups: GroupRepository = new GroupRepository(),
  ) {}

  async groupStats(groupId: number, windowDays = 7): Promise<GroupStats> {
    const group = await this.groups.findById(groupId);
    if (!group) throw new NotFoundError('Group');

    const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
    const messages = await this.activity.between(groupId, since);
    const humanMessages = messages.filter((m) => !m.isFromBot);
    const lastHuman = humanMessages.at(-1)?.timestamp ?? null;

    return {
      groupId,
      name: group.name,
      windowDays,
      totalMessages: messages.length,
      humanMessages: humanMessages.length,
      botMessages: messages.length - humanMessages.length,
      activeContributors: new Set(humanMessages.map((m) => m.authorId)).size,
      topContributors: await this.activity.topContributors(groupId, since),
      daily: await this.activity.dailyCounts(groupId, since),
      lastMessageAt: lastHuman,
      idleHours: lastHuman ? (Date.now() - new Date(lastHuman).getTime()) / 3_600_000 : null,
    };
  }

  async overview(windowDays = 7): Promise<GroupStats[]> {
    const groups = await this.groups.list();
    return Promise.all(groups.map((g) => this.groupStats(g.id, windowDays)));
  }

  /** RFC-4180-ish CSV export of chat statistics. */
  async exportCsv(windowDays = 30): Promise<string> {
    const rows = await this.overview(windowDays);
    const header = [
      'group_id',
      'group_name',
      'window_days',
      'total_messages',
      'human_messages',
      'bot_messages',
      'active_contributors',
      'last_message_at',
      'idle_hours',
    ];
    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = rows.map((r) =>
      [
        r.groupId,
        r.name,
        r.windowDays,
        r.totalMessages,
        r.humanMessages,
        r.botMessages,
        r.activeContributors,
        r.lastMessageAt ?? '',
        r.idleHours === null ? '' : r.idleHours.toFixed(2),
      ]
        .map(escape)
        .join(','),
    );
    return [header.join(','), ...lines].join('\n');
  }
}

export const analyticsService = new AnalyticsService();
