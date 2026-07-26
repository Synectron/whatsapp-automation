/**
 * Audit trail: writes to both Winston (files) and the `logs` table (dashboard),
 * so operational and product-level logging never drift apart.
 */
import { config } from '../config';
import { childLogger } from '../utils/logger';
import { eventBus } from '../utils/events';
import { LogRepository } from '../repositories/logRepository';
import type { LogLevel } from '../models/types';

const log = childLogger('audit');

/** Canonical event names — keeps log queries and dashboards stable. */
export const AuditEvent = {
  Login: 'login',
  Logout: 'logout',
  DashboardLogin: 'dashboard_login',
  DashboardLoginFailed: 'dashboard_login_failed',
  DashboardLogout: 'dashboard_logout',
  QrGenerated: 'qr_generated',
  Authenticated: 'authenticated',
  AuthFailure: 'auth_failure',
  Ready: 'ready',
  Disconnected: 'disconnected',
  Reconnect: 'reconnect',
  MessageSent: 'message_sent',
  MessageQueued: 'message_queued',
  MessageFailed: 'message_failed',
  MessageReceived: 'message_received',
  ScheduleFired: 'schedule_fired',
  ScheduleSkipped: 'schedule_skipped',
  ScheduleCreated: 'schedule_created',
  ScheduleUpdated: 'schedule_updated',
  ScheduleDeleted: 'schedule_deleted',
  GroupSynced: 'group_synced',
  GroupToggled: 'group_toggled',
  InactivityNudge: 'inactivity_nudge',
  MotivationSent: 'motivation_sent',
  AiResponse: 'ai_response',
  AiError: 'ai_error',
  AiSummary: 'ai_summary',
  SettingsUpdated: 'settings_updated',
  SetupCompleted: 'setup_completed',
  BackupCreated: 'backup_created',
  BackupRestored: 'backup_restored',
  Error: 'error',
} as const;

export type AuditEventName = (typeof AuditEvent)[keyof typeof AuditEvent];

export class AuditService {
  constructor(private readonly repo: LogRepository = new LogRepository()) {}

  async record(event: AuditEventName | string, details?: unknown, level: LogLevel = 'info', groupId?: number | null) {
    try {
      const row = await this.repo.add(event, details, level, groupId ?? null);
      eventBus.emit('log:created', { id: row.id, event: row.event, level: row.level, details: row.details ?? undefined });
      log.log(level, `[${event}]`, { details });
      return row;
    } catch (err) {
      // Never let audit failures break a business flow.
      log.error('Failed to persist audit log', { event, error: (err as Error).message });
      return null;
    }
  }

  info = (event: AuditEventName | string, details?: unknown, groupId?: number | null) =>
    this.record(event, details, 'info', groupId);
  warn = (event: AuditEventName | string, details?: unknown, groupId?: number | null) =>
    this.record(event, details, 'warn', groupId);
  error = (event: AuditEventName | string, details?: unknown, groupId?: number | null) =>
    this.record(event, details, 'error', groupId);

  /** Enforces the configured retention window. */
  async prune(): Promise<number> {
    const removed = await this.repo.prune(config.logging.dbRetention);
    if (removed) log.debug('Pruned audit log rows', { removed });
    return removed;
  }

  query = this.repo.query.bind(this.repo);
  distinctEvents = this.repo.distinctEvents.bind(this.repo);
  clear = this.repo.clear.bind(this.repo);
}

export const audit = new AuditService();
