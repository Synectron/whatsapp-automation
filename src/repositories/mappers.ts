/** snake_case row → camelCase domain object mappers. */
import { parseJson, toBool } from '../database';
import type {
  ActivityRecord,
  GroupRecord,
  HolidayRecord,
  LogRecord,
  OutboxRecord,
  ScheduleRecord,
  SettingRecord,
  TemplateRecord,
} from '../models/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const mapGroup = (row: any): GroupRecord => ({
  id: row.id,
  whatsappId: row.whatsapp_id,
  name: row.name,
  enabled: toBool(row.enabled),
  description: row.description ?? null,
  participantCount: row.participant_count ?? null,
  lastMessageAt: row.last_message_at ?? null,
  lastReminderAt: row.last_reminder_at ?? null,
  metadata: parseJson<Record<string, unknown> | null>(row.metadata, null),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapSchedule = (row: any): ScheduleRecord => ({
  id: row.id,
  groupId: row.group_id,
  name: row.name,
  kind: row.kind,
  cron: row.cron,
  message: row.message,
  templateId: row.template_id ?? null,
  timezone: row.timezone ?? null,
  enabled: toBool(row.enabled),
  mentionAll: toBool(row.mention_all),
  skipHolidays: toBool(row.skip_holidays),
  runOnce: toBool(row.run_once),
  lastRunAt: row.last_run_at ?? null,
  nextRunHint: row.next_run_hint ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapLog = (row: any): LogRecord => ({
  id: row.id,
  timestamp: row.timestamp,
  level: row.level,
  event: row.event,
  details: row.details ?? null,
  groupId: row.group_id ?? null,
});

export const mapSetting = (row: any): SettingRecord => ({
  key: row.key,
  value: row.value,
  updatedAt: row.updated_at,
});

export const mapOutbox = (row: any): OutboxRecord => ({
  id: row.id,
  groupWhatsappId: row.group_whatsapp_id,
  groupId: row.group_id ?? null,
  body: row.body,
  mentions: row.mentions ?? null,
  status: row.status,
  attempts: row.attempts,
  maxAttempts: row.max_attempts,
  nextAttemptAt: row.next_attempt_at,
  lastError: row.last_error ?? null,
  source: row.source,
  dedupeKey: row.dedupe_key ?? null,
  createdAt: row.created_at,
  sentAt: row.sent_at ?? null,
});

export const mapTemplate = (row: any): TemplateRecord => ({
  id: row.id,
  name: row.name,
  category: row.category,
  body: row.body,
  enabled: toBool(row.enabled),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapActivity = (row: any): ActivityRecord => ({
  id: row.id,
  groupId: row.group_id,
  whatsappId: row.whatsapp_id,
  authorId: row.author_id ?? null,
  authorName: row.author_name ?? null,
  messageId: row.message_id ?? null,
  body: row.body ?? null,
  isFromBot: toBool(row.is_from_bot),
  timestamp: row.timestamp,
});

export const mapHoliday = (row: any): HolidayRecord => ({
  id: row.id,
  date: row.date,
  name: row.name,
  enabled: toBool(row.enabled),
});
