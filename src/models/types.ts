/** Domain types shared across layers. */

export type ConnectionStatus =
  | 'initializing'
  | 'qr'
  | 'authenticated'
  | 'ready'
  | 'disconnected'
  | 'auth_failure'
  | 'reconnecting'
  | 'stopped';

export type ScheduleKind = 'reminder' | 'meeting' | 'motivation' | 'custom';

export type OutboxStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface GroupRecord {
  id: number;
  whatsappId: string;
  name: string;
  enabled: boolean;
  description: string | null;
  participantCount: number | null;
  lastMessageAt: string | null;
  lastReminderAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleRecord {
  id: number;
  groupId: number;
  name: string;
  kind: ScheduleKind;
  cron: string;
  message: string;
  templateId: number | null;
  timezone: string | null;
  enabled: boolean;
  mentionAll: boolean;
  skipHolidays: boolean;
  runOnce: boolean;
  lastRunAt: string | null;
  nextRunHint: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LogRecord {
  id: number;
  timestamp: string;
  level: LogLevel;
  event: string;
  details: string | null;
  groupId: number | null;
}

export interface SettingRecord {
  key: string;
  value: string;
  updatedAt: string;
}

export interface OutboxRecord {
  id: number;
  groupWhatsappId: string;
  groupId: number | null;
  body: string;
  mentions: string | null;
  status: OutboxStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  source: string;
  dedupeKey: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface TemplateRecord {
  id: number;
  name: string;
  category: string;
  body: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityRecord {
  id: number;
  groupId: number;
  whatsappId: string;
  authorId: string | null;
  authorName: string | null;
  messageId: string | null;
  body: string | null;
  isFromBot: boolean;
  timestamp: string;
}

export interface HolidayRecord {
  id: number;
  date: string;
  name: string;
  enabled: boolean;
}

export interface InboundMessage {
  messageId: string;
  chatId: string;
  chatName: string;
  authorId: string;
  authorName: string;
  body: string;
  isGroup: boolean;
  fromMe: boolean;
  timestamp: string;
}

export interface StatusSnapshot {
  status: ConnectionStatus;
  connected: boolean;
  detail?: string;
  pushname?: string;
  wid?: string;
  qrAvailable: boolean;
  lastQrAt?: string;
  connectedSince?: string;
  reconnectAttempts: number;
  dryRun: boolean;
  uptimeSeconds: number;
  queue: { pending: number; failed: number; sentLastHour: number };
  scheduler: { enabled: boolean; activeJobs: number };
  ai: { enabled: boolean; provider: string; ready: boolean };
  version: string;
}
