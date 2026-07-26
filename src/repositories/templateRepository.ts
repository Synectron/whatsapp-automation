/** Reusable message templates. */
import type { Knex } from 'knex';
import { db, nowIso } from '../database';
import { mapTemplate } from './mappers';
import type { TemplateRecord } from '../models/types';

export interface TemplateInput {
  name: string;
  category?: string;
  body: string;
  enabled?: boolean;
}

export class TemplateRepository {
  private readonly injected?: Knex;

  /** `knex` is resolved lazily so tests can swap the connection via setDb(). */
  constructor(knex?: Knex) {
    this.injected = knex;
  }

  private get knex(): Knex {
    return this.injected ?? db();
  }

  private table() {
    return this.knex('templates');
  }

  async list(category?: string): Promise<TemplateRecord[]> {
    const query = this.table().select('*').orderBy(['category', 'name']);
    if (category) query.where({ category });
    return (await query).map(mapTemplate);
  }

  async listEnabled(category: string): Promise<TemplateRecord[]> {
    return (await this.table().select('*').where({ category, enabled: true }).orderBy('name')).map(mapTemplate);
  }

  async findById(id: number): Promise<TemplateRecord | null> {
    const row = await this.table().where({ id }).first();
    return row ? mapTemplate(row) : null;
  }

  async create(input: TemplateInput): Promise<TemplateRecord> {
    const now = nowIso();
    const [row] = await this.table()
      .insert({
        name: input.name,
        category: input.category ?? 'general',
        body: input.body,
        enabled: input.enabled ?? true,
        created_at: now,
        updated_at: now,
      })
      .returning('id');
    const id = typeof row === 'object' ? (row as { id: number }).id : (row as number);
    return (await this.findById(id))!;
  }

  async update(id: number, patch: Partial<TemplateInput>): Promise<TemplateRecord | null> {
    const payload: Record<string, unknown> = { updated_at: nowIso() };
    if (patch.name !== undefined) payload.name = patch.name;
    if (patch.category !== undefined) payload.category = patch.category;
    if (patch.body !== undefined) payload.body = patch.body;
    if (patch.enabled !== undefined) payload.enabled = patch.enabled;
    await this.table().where({ id }).update(payload);
    return this.findById(id);
  }

  async remove(id: number): Promise<boolean> {
    return (await this.table().where({ id }).delete()) > 0;
  }
}

export const templateRepository = () => new TemplateRepository();
