/** Zod schemas shared by the REST API and the dashboard form handlers. */
import { z } from 'zod';
import { validateCron } from '../../utils/cron';

export const cronField = z
  .string()
  .min(1, 'Cron expression is required')
  .refine((v) => validateCron(v).valid, (v) => ({ message: validateCron(v).reason ?? 'Invalid cron expression' }));

export const booleanish = z.union([z.boolean(), z.enum(['true', 'false', 'on', 'off', '1', '0'])]).transform((v) => {
  if (typeof v === 'boolean') return v;
  return v === 'true' || v === 'on' || v === '1';
});

export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const sendMessageSchema = z
  .object({
    groupId: z.coerce.number().int().positive().optional(),
    whatsappId: z.string().regex(/@(g|c)\.us$/, 'Must be a WhatsApp chat id').optional(),
    message: z.string().min(1, 'Message body is required').max(4096),
    mentionAll: booleanish.optional().default(false),
    mentions: z.array(z.string()).optional(),
    vars: z.record(z.union([z.string(), z.number()])).optional(),
    force: booleanish.optional().default(false),
    dedupeKey: z.string().max(200).optional(),
  })
  .refine((v) => v.groupId !== undefined || v.whatsappId !== undefined, {
    message: 'Provide either groupId or whatsappId.',
    path: ['groupId'],
  });

export const broadcastSchema = z.object({
  message: z.string().min(1).max(4096),
  mentionAll: booleanish.optional().default(false),
});

export const createScheduleSchema = z.object({
  groupId: z.coerce.number().int().positive(),
  name: z.string().min(1).max(160),
  cron: cronField,
  message: z.string().min(1).max(4096),
  kind: z.enum(['reminder', 'meeting', 'motivation', 'custom']).optional().default('reminder'),
  templateId: z.coerce.number().int().positive().nullable().optional(),
  timezone: z.string().max(64).nullable().optional(),
  enabled: booleanish.optional().default(true),
  mentionAll: booleanish.optional().default(false),
  skipHolidays: booleanish.optional().default(true),
  runOnce: booleanish.optional().default(false),
});

export const updateScheduleSchema = createScheduleSchema.partial();

export const groupToggleSchema = z.object({ enabled: booleanish });

export const logQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  event: z.string().max(64).optional(),
  groupId: z.coerce.number().int().positive().optional(),
  since: z.string().datetime().optional(),
  search: z.string().max(200).optional(),
});

export const templateSchema = z.object({
  name: z.string().min(1).max(160),
  category: z.string().min(1).max(48).optional().default('general'),
  body: z.string().min(1).max(4096),
  enabled: booleanish.optional().default(true),
});

export const settingsSchema = z.record(z.string().max(4096));

export const meetingReminderSchema = z.object({
  groupId: z.coerce.number().int().positive(),
  title: z.string().min(1).max(160),
  /** ISO date-time of the meeting itself. */
  startsAt: z.string().datetime(),
  minutesBefore: z.coerce.number().int().min(1).max(1440).optional().default(30),
  message: z.string().max(4096).optional(),
});

export const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  name: z.string().min(1).max(160),
});
