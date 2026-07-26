import type { Knex } from 'knex';
import { createTestDb, destroyTestDb, insertGroup, seedTestDb } from '../helpers/testDb';
import { FakeGateway } from '../helpers/fakeGateway';
import { MessageQueue } from '../../src/whatsapp/messageQueue';
import { MessageService } from '../../src/services/messageService';
import { GroupService } from '../../src/services/groupService';
import { ActivityService } from '../../src/services/activityService';
import { ScheduleService } from '../../src/services/scheduleService';
import { SchedulerService } from '../../src/scheduler';
import { AiService } from '../../src/ai';
import { NoopProvider } from '../../src/ai/noopProvider';
import { OutboxRepository } from '../../src/repositories/outboxRepository';
import { ActivityRepository } from '../../src/repositories/activityRepository';
import { ValidationError } from '../../src/utils/errors';
import { localDateKey } from '../../src/utils/time';

describe('scheduler', () => {
  let knex: Knex;
  let gateway: FakeGateway;
  let queue: MessageQueue;
  let scheduler: SchedulerService;
  let schedules: ScheduleService;
  let messages: MessageService;
  let groups: GroupService;
  let groupId: number;

  beforeEach(async () => {
    knex = await createTestDb();
    await seedTestDb(knex);
    groupId = await insertGroup(knex, { enabled: true });

    gateway = new FakeGateway();
    queue = new MessageQueue({ gateway, outbox: new OutboxRepository(knex) });
    groups = new GroupService(gateway);
    messages = new MessageService(queue, groups);
    const activity = new ActivityService(groups);
    schedules = new ScheduleService();
    scheduler = new SchedulerService({
      groups,
      messages,
      activity,
      schedules,
      ai: new AiService(new NoopProvider()),
    });
  });

  afterEach(async () => {
    scheduler.stop();
    await destroyTestDb(knex);
  });

  it('rejects invalid cron expressions at creation time', async () => {
    await expect(
      schedules.create({ groupId, name: 'Bad', cron: 'not-a-cron', message: 'hi' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('queues a message when a schedule fires', async () => {
    const schedule = await schedules.create({
      groupId,
      name: 'Morning',
      cron: '30 9 * * *',
      message: 'Good morning {{group}} 👋',
    });

    await expect(scheduler.fire(schedule.id)).resolves.toBe('queued');
    await queue.drain();
    expect(gateway.sent[0].body).toContain('Good morning Test Group');
  });

  it('does not double-post when the same slot fires twice', async () => {
    const schedule = await schedules.create({
      groupId,
      name: 'Morning',
      cron: '30 9 * * *',
      message: 'once only',
    });

    await scheduler.fire(schedule.id);
    await expect(scheduler.fire(schedule.id)).resolves.toBe('duplicate');
    await queue.drain();
    expect(gateway.sent).toHaveLength(1);
  });

  it('skips groups that are disabled', async () => {
    const disabledGroupId = await insertGroup(knex, { whatsapp_id: '999@g.us', enabled: false });
    const schedule = await schedules.create({
      groupId: disabledGroupId,
      name: 'Quiet',
      cron: '0 9 * * *',
      message: 'should not send',
    });

    await expect(scheduler.fire(schedule.id)).resolves.toBe('skipped');
    await queue.drain();
    expect(gateway.sent).toHaveLength(0);
  });

  it('suppresses reminders on configured holidays', async () => {
    const holidayDate = localDateKey();
    await knex('holidays').insert({ date: holidayDate, name: 'Test Holiday', enabled: true });
    const schedule = await schedules.create({
      groupId,
      name: 'Daily',
      cron: '0 9 * * *',
      message: 'holiday check',
      skipHolidays: true,
    });

    await expect(scheduler.fire(schedule.id)).resolves.toBe('skipped');
  });

  it('still fires on a holiday when skipHolidays is off', async () => {
    const holidayDate = localDateKey();
    await knex('holidays').insert({ date: holidayDate, name: 'Test Holiday', enabled: true });
    const schedule = await schedules.create({
      groupId,
      name: 'Daily',
      cron: '0 9 * * *',
      message: 'fire anyway',
      skipHolidays: false,
    });

    await expect(scheduler.fire(schedule.id)).resolves.toBe('queued');
  });

  it('disables one-shot meeting reminders after they fire', async () => {
    const schedule = await schedules.create({
      groupId,
      name: 'Sprint planning',
      kind: 'meeting',
      cron: '0 10 * * *',
      message: 'Reminder ⏰ Sprint planning starts in 30 minutes.',
      runOnce: true,
      skipHolidays: false,
    });

    await scheduler.fire(schedule.id);
    await expect(schedules.get(schedule.id)).resolves.toMatchObject({ enabled: false });
  });

  it('nudges groups that have gone quiet', async () => {
    const activityRepo = new ActivityRepository(knex);
    await activityRepo.record({
      groupId,
      whatsappId: '123456789@g.us',
      body: 'last message',
      timestamp: new Date(Date.now() - 48 * 3_600_000).toISOString(),
    });

    const nudged = await scheduler.systemJobs.runInactivityCheck(new Date('2026-07-26T09:00:00.000Z'));
    expect(nudged).toBe(1);
    await queue.drain();
    expect(gateway.sent[0].body).toContain('Just checking in');
  });

  it('does not nudge a group that is still active', async () => {
    const activityRepo = new ActivityRepository(knex);
    await activityRepo.record({ groupId, whatsappId: '123456789@g.us', body: 'recent', timestamp: new Date().toISOString() });
    await expect(
      scheduler.systemJobs.runInactivityCheck(new Date('2026-07-26T09:00:00.000Z')),
    ).resolves.toBe(0);
  });

  it('stays silent during quiet hours', async () => {
    const activityRepo = new ActivityRepository(knex);
    await activityRepo.record({
      groupId,
      whatsappId: '123456789@g.us',
      body: 'old',
      timestamp: new Date(Date.now() - 48 * 3_600_000).toISOString(),
    });
    // 20:00 UTC = 01:30 IST, inside the default 22:00–08:00 quiet window.
    await expect(
      scheduler.systemJobs.runInactivityCheck(new Date('2026-07-26T20:00:00.000Z')),
    ).resolves.toBe(0);
  });

  it('sends a random motivation template when enabled', async () => {
    await knex('settings').where({ key: 'motivation.enabled' }).update({ value: 'true' });
    const sent = await scheduler.systemJobs.runMotivation(new Date('2026-07-26T09:00:00.000Z'));
    expect(sent).toBe(1);
    await queue.drain();
    expect(gateway.sent).toHaveLength(1);
  });
});
