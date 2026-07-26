/**
 * Composition root.
 *
 * All wiring lives here: every other module receives its collaborators through
 * the constructor, which keeps them unit-testable and free of import cycles.
 */
import { config } from './config';
import { childLogger } from './utils/logger';
import { eventBus } from './utils/events';
import { whatsappClient } from './whatsapp/client';
import { MessageQueue } from './whatsapp/messageQueue';
import { GroupService } from './services/groupService';
import { MessageService } from './services/messageService';
import { ActivityService } from './services/activityService';
import { FollowUpService } from './services/followUpService';
import { scheduleService } from './services/scheduleService';
import { audit, AuditEvent } from './services/auditService';
import { settingsService } from './services/settingsService';
import { SetupService, setupService } from './services/setupService';
import { analyticsService } from './services/analyticsService';
import { backupService } from './services/backupService';
import { SchedulerService } from './scheduler';
import { aiService } from './ai';
import type { WhatsAppGateway } from './whatsapp/gateway';

const log = childLogger('container');

export interface Container {
  gateway: WhatsAppGateway;
  queue: MessageQueue;
  groups: GroupService;
  messages: MessageService;
  activity: ActivityService;
  followUp: FollowUpService;
  schedules: typeof scheduleService;
  settings: typeof settingsService;
  analytics: typeof analyticsService;
  backups: typeof backupService;
  scheduler: SchedulerService;
  setup: SetupService;
  ai: typeof aiService;
  audit: typeof audit;
  startedAt: Date;
}

export interface BuildContainerOptions {
  gateway?: WhatsAppGateway;
  /** Overridable so tests can simulate an unconfigured first boot. */
  setup?: SetupService;
}

/** Builds the object graph. Pass a fake gateway in tests. */
export function buildContainer(options: BuildContainerOptions = {}): Container {
  const gateway = options.gateway ?? whatsappClient;
  const queue = new MessageQueue({ gateway });
  const groups = new GroupService(gateway);
  const messages = new MessageService(queue, groups);
  const activity = new ActivityService(groups);
  const followUp = new FollowUpService(groups, activity, messages, aiService);
  const scheduler = new SchedulerService({
    groups,
    messages,
    activity,
    schedules: scheduleService,
    ai: aiService,
  });

  return {
    gateway,
    queue,
    groups,
    messages,
    activity,
    followUp,
    schedules: scheduleService,
    settings: settingsService,
    analytics: analyticsService,
    backups: backupService,
    scheduler,
    setup: options.setup ?? setupService,
    ai: aiService,
    audit,
    startedAt: new Date(),
  };
}

/**
 * Bridges WhatsApp events into the audit log, activity tracking and the
 * follow-up engine. Returns an unsubscribe function.
 */
export function wireEventHandlers(container: Container): () => void {
  const unsubscribers: Array<() => void> = [];

  unsubscribers.push(
    eventBus.on('wa:qr', ({ generatedAt }) => {
      void audit.info(AuditEvent.QrGenerated, { generatedAt });
    }),
  );

  unsubscribers.push(
    eventBus.on('wa:authenticated', () => {
      void audit.info(AuditEvent.Authenticated, {});
    }),
  );

  unsubscribers.push(
    eventBus.on('wa:auth_failure', ({ message }) => {
      void audit.error(AuditEvent.AuthFailure, { message });
    }),
  );

  unsubscribers.push(
    eventBus.on('wa:ready', (info) => {
      void audit.info(AuditEvent.Ready, info);
      // Refresh the group list on every successful connection.
      void container.groups.sync().catch((err) => log.warn('Group sync failed', { error: err.message }));
    }),
  );

  unsubscribers.push(
    eventBus.on('wa:disconnected', ({ reason }) => {
      void audit.warn(AuditEvent.Disconnected, { reason });
    }),
  );

  unsubscribers.push(
    eventBus.on('wa:status', ({ status, detail }) => {
      if (status === 'reconnecting') void audit.warn(AuditEvent.Reconnect, { detail });
    }),
  );

  unsubscribers.push(
    eventBus.on('wa:message', (message) => {
      void container.followUp
        .handle(message)
        .catch((err) => log.error('Follow-up handling failed', { error: (err as Error).message }));
    }),
  );

  return () => unsubscribers.forEach((off) => off());
}

/** Starts background workers (queue + scheduler) and the WhatsApp client. */
export async function startRuntime(container: Container): Promise<void> {
  container.queue.start();
  if (config.scheduler.enabled) await container.scheduler.start();
  else log.warn('Scheduler disabled by configuration');
  await container.gateway.initialize();
}

/** Stops background workers. Safe to call multiple times. */
export async function stopRuntime(container: Container): Promise<void> {
  container.queue.stop();
  container.scheduler.stop();
  await container.gateway.destroy().catch((err) => log.warn('Gateway shutdown failed', { error: err.message }));
}
