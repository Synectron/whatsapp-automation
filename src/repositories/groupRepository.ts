/** Data access for WhatsApp groups. */
import type { Knex } from 'knex';
import { db, nowIso } from '../database';
import { mapGroup } from './mappers';
import type { GroupRecord } from '../models/types';

export interface GroupUpsert {
  whatsappId: string;
  name: string;
  description?: string | null;
  participantCount?: number | null;
  metadata?: Record<string, unknown> | null;
}

export class GroupRepository {
  private readonly injected?: Knex;

  /** `knex` is resolved lazily so tests can swap the connection via setDb(). */
  constructor(knex?: Knex) {
    this.injected = knex;
  }

  private get knex(): Knex {
    return this.injected ?? db();
  }

  private table() {
    return this.knex('groups');
  }

  async list(options: { enabledOnly?: boolean } = {}): Promise<GroupRecord[]> {
    const query = this.table().select('*').orderBy('name', 'asc');
    if (options.enabledOnly) query.where({ enabled: true });
    return (await query).map(mapGroup);
  }

  async findById(id: number): Promise<GroupRecord | null> {
    const row = await this.table().where({ id }).first();
    return row ? mapGroup(row) : null;
  }

  async findByWhatsappId(whatsappId: string): Promise<GroupRecord | null> {
    const row = await this.table().where({ whatsapp_id: whatsappId }).first();
    return row ? mapGroup(row) : null;
  }

  /** Inserts a group or refreshes its mutable metadata, preserving `enabled`. */
  async upsert(input: GroupUpsert): Promise<GroupRecord> {
    const now = nowIso();
    const existing = await this.findByWhatsappId(input.whatsappId);
    if (existing) {
      await this.table()
        .where({ id: existing.id })
        .update({
          name: input.name,
          description: input.description ?? existing.description,
          participant_count: input.participantCount ?? existing.participantCount,
          metadata: input.metadata ? JSON.stringify(input.metadata) : existing.metadata ? JSON.stringify(existing.metadata) : null,
          updated_at: now,
        });
      return (await this.findById(existing.id))!;
    }
    const [row] = await this.table()
      .insert({
        whatsapp_id: input.whatsappId,
        name: input.name,
        enabled: false,
        description: input.description ?? null,
        participant_count: input.participantCount ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        created_at: now,
        updated_at: now,
      })
      .returning('id');
    const id = typeof row === 'object' ? (row as { id: number }).id : (row as number);
    return (await this.findById(id))!;
  }

  async setEnabled(id: number, enabled: boolean): Promise<GroupRecord | null> {
    await this.table().where({ id }).update({ enabled, updated_at: nowIso() });
    return this.findById(id);
  }

  async touchLastMessage(whatsappId: string, at: string = nowIso()): Promise<void> {
    await this.table().where({ whatsapp_id: whatsappId }).update({ last_message_at: at, updated_at: nowIso() });
  }

  async touchLastReminder(id: number, at: string = nowIso()): Promise<void> {
    await this.table().where({ id }).update({ last_reminder_at: at, updated_at: nowIso() });
  }

  async remove(id: number): Promise<boolean> {
    return (await this.table().where({ id }).delete()) > 0;
  }

  async count(): Promise<{ total: number; enabled: number }> {
    const rows = await this.table().select('enabled');
    return {
      total: rows.length,
      enabled: rows.filter((r: { enabled: unknown }) => r.enabled === true || r.enabled === 1).length,
    };
  }
}

export const groupRepository = () => new GroupRepository();
