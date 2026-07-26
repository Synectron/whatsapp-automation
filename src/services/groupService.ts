/** Group discovery, persistence and enable/disable management. */
import { childLogger } from '../utils/logger';
import { GroupRepository } from '../repositories/groupRepository';
import { NotFoundError } from '../utils/errors';
import { audit, AuditEvent } from './auditService';
import type { WhatsAppGateway } from '../whatsapp/gateway';
import type { GroupRecord } from '../models/types';

const log = childLogger('group-service');

export class GroupService {
  constructor(
    private readonly gateway: WhatsAppGateway,
    private readonly repo: GroupRepository = new GroupRepository(),
  ) {}

  /**
   * Pulls the group list from WhatsApp and upserts it. New groups start
   * disabled so the bot never posts anywhere without an explicit opt-in.
   */
  async sync(): Promise<{ discovered: number; groups: GroupRecord[] }> {
    const remote = await this.gateway.fetchGroups();
    for (const group of remote) {
      await this.repo.upsert({
        whatsappId: group.whatsappId,
        name: group.name,
        description: group.description ?? null,
        participantCount: group.participantCount ?? null,
        metadata: group.participants ? { participants: group.participants } : null,
      });
    }
    const groups = await this.repo.list();
    await audit.info(AuditEvent.GroupSynced, { discovered: remote.length, stored: groups.length });
    log.info('Group sync complete', { discovered: remote.length });
    return { discovered: remote.length, groups };
  }

  list(enabledOnly = false): Promise<GroupRecord[]> {
    return this.repo.list({ enabledOnly });
  }

  async getById(id: number): Promise<GroupRecord> {
    const group = await this.repo.findById(id);
    if (!group) throw new NotFoundError('Group');
    return group;
  }

  getByWhatsappId(whatsappId: string): Promise<GroupRecord | null> {
    return this.repo.findByWhatsappId(whatsappId);
  }

  async setEnabled(id: number, enabled: boolean): Promise<GroupRecord> {
    const group = await this.repo.setEnabled(id, enabled);
    if (!group) throw new NotFoundError('Group');
    await audit.info(AuditEvent.GroupToggled, { id, name: group.name, enabled }, id);
    return group;
  }

  /** Participant ids stored during sync — used for @-mention broadcasts. */
  async participantIds(id: number): Promise<string[]> {
    const group = await this.getById(id);
    const participants = (group.metadata?.participants ?? []) as Array<{ id: string }>;
    return participants.map((p) => p.id).filter(Boolean);
  }

  counts() {
    return this.repo.count();
  }

  touchLastMessage(whatsappId: string, at?: string) {
    return this.repo.touchLastMessage(whatsappId, at);
  }

  touchLastReminder(id: number, at?: string) {
    return this.repo.touchLastReminder(id, at);
  }
}
