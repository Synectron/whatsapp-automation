/**
 * Database backup & restore.
 *
 * Portable across dialects: the backup is a JSON snapshot of every application
 * table rather than a dialect-specific dump, so a SQLite backup can be restored
 * into PostgreSQL and vice versa.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import { ensureDir } from '../config/env';
import { db, nowIso } from '../database';
import { childLogger } from '../utils/logger';
import { ValidationError } from '../utils/errors';
import { audit, AuditEvent } from './auditService';

const log = childLogger('backup-service');

/** Order matters: parents before children so foreign keys resolve on restore. */
const TABLES = ['groups', 'schedules', 'templates', 'holidays', 'settings', 'logs', 'outbox', 'group_activity'] as const;

export interface BackupFile {
  name: string;
  size: number;
  createdAt: string;
}

export interface BackupPayload {
  version: 1;
  createdAt: string;
  client: string;
  tables: Record<string, unknown[]>;
}

export class BackupService {
  private get dir(): string {
    return ensureDir(config.paths.backups);
  }

  async create(): Promise<{ file: string; payload: BackupPayload }> {
    const knex = db();
    const payload: BackupPayload = { version: 1, createdAt: nowIso(), client: config.db.client, tables: {} };
    for (const table of TABLES) {
      payload.tables[table] = await knex(table).select('*');
    }
    const name = `backup-${payload.createdAt.replace(/[:.]/g, '-')}.json`;
    const file = path.join(this.dir, name);
    await fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf8');
    await audit.info(AuditEvent.BackupCreated, { file: name, tables: TABLES.length });
    log.info('Backup created', { file: name });
    return { file, payload };
  }

  async list(): Promise<BackupFile[]> {
    const entries = await fs.readdir(this.dir).catch(() => [] as string[]);
    const files: BackupFile[] = [];
    for (const entry of entries.filter((e) => e.endsWith('.json'))) {
      const stat = await fs.stat(path.join(this.dir, entry));
      files.push({ name: entry, size: stat.size, createdAt: stat.mtime.toISOString() });
    }
    return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Replaces the current contents of every backed-up table. Destructive. */
  async restore(fileName: string): Promise<{ restored: Record<string, number> }> {
    if (!/^[\w.-]+\.json$/.test(fileName)) throw new ValidationError('Invalid backup file name.');
    const file = path.join(this.dir, fileName);
    const raw = await fs.readFile(file, 'utf8').catch(() => {
      throw new ValidationError(`Backup file "${fileName}" was not found.`);
    });
    const payload = JSON.parse(raw) as BackupPayload;
    if (payload.version !== 1) throw new ValidationError(`Unsupported backup version: ${payload.version}`);

    const knex = db();
    const restored: Record<string, number> = {};
    await knex.transaction(async (trx) => {
      for (const table of [...TABLES].reverse()) await trx(table).delete();
      for (const table of TABLES) {
        const rows = payload.tables[table] ?? [];
        if (rows.length) await trx.batchInsert(table, rows as Record<string, unknown>[], 200);
        restored[table] = rows.length;
      }
    });
    await audit.warn(AuditEvent.BackupRestored, { file: fileName, restored });
    log.warn('Backup restored', { file: fileName });
    return { restored };
  }

  async remove(fileName: string): Promise<void> {
    if (!/^[\w.-]+\.json$/.test(fileName)) throw new ValidationError('Invalid backup file name.');
    await fs.unlink(path.join(this.dir, fileName));
  }
}

export const backupService = new BackupService();
