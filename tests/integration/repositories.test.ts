import type { Knex } from 'knex';
import { createTestDb, destroyTestDb, insertGroup, seedTestDb } from '../helpers/testDb';
import { GroupRepository } from '../../src/repositories/groupRepository';
import { ScheduleRepository } from '../../src/repositories/scheduleRepository';
import { OutboxRepository } from '../../src/repositories/outboxRepository';
import { LogRepository } from '../../src/repositories/logRepository';
import { SettingsRepository } from '../../src/repositories/settingsRepository';
import { ActivityRepository } from '../../src/repositories/activityRepository';
import { HolidayRepository } from '../../src/repositories/holidayRepository';

describe('repositories', () => {
  let knex: Knex;

  beforeEach(async () => {
    knex = await createTestDb();
  });

  afterEach(async () => {
    await destroyTestDb(knex);
  });

  describe('GroupRepository', () => {
    it('creates groups disabled by default', async () => {
      const repo = new GroupRepository(knex);
      const group = await repo.upsert({ whatsappId: '1@g.us', name: 'Team' });
      expect(group.enabled).toBe(false);
    });

    it('preserves the enabled flag on re-sync', async () => {
      const repo = new GroupRepository(knex);
      const group = await repo.upsert({ whatsappId: '1@g.us', name: 'Team' });
      await repo.setEnabled(group.id, true);
      const resynced = await repo.upsert({ whatsappId: '1@g.us', name: 'Team Renamed' });
      expect(resynced.enabled).toBe(true);
      expect(resynced.name).toBe('Team Renamed');
    });

    it('counts total and enabled groups', async () => {
      const repo = new GroupRepository(knex);
      const a = await repo.upsert({ whatsappId: '1@g.us', name: 'A' });
      await repo.upsert({ whatsappId: '2@g.us', name: 'B' });
      await repo.setEnabled(a.id, true);
      await expect(repo.count()).resolves.toEqual({ total: 2, enabled: 1 });
    });
  });

  describe('ScheduleRepository', () => {
    it('claims a fire slot exactly once', async () => {
      const groupId = await insertGroup(knex);
      const repo = new ScheduleRepository(knex);
      const schedule = await repo.create({ groupId, name: 'Daily', cron: '30 9 * * *', message: 'hi' });

      await expect(repo.claimRun(schedule.id, '2026-07-26T09:30')).resolves.toBe(true);
      await expect(repo.claimRun(schedule.id, '2026-07-26T09:30')).resolves.toBe(false);
      await expect(repo.claimRun(schedule.id, '2026-07-27T09:30')).resolves.toBe(true);
    });

    it('lists only schedules whose group is enabled', async () => {
      const enabledGroup = await insertGroup(knex, { whatsapp_id: '1@g.us', enabled: true });
      const disabledGroup = await insertGroup(knex, { whatsapp_id: '2@g.us', enabled: false });
      const repo = new ScheduleRepository(knex);
      await repo.create({ groupId: enabledGroup, name: 'A', cron: '0 9 * * *', message: 'a' });
      await repo.create({ groupId: disabledGroup, name: 'B', cron: '0 9 * * *', message: 'b' });

      const active = await repo.listActive();
      expect(active).toHaveLength(1);
      expect(active[0].name).toBe('A');
    });

    it('cascades deletes from groups', async () => {
      const groupId = await insertGroup(knex);
      const repo = new ScheduleRepository(knex);
      await repo.create({ groupId, name: 'A', cron: '0 9 * * *', message: 'a' });
      await knex('groups').where({ id: groupId }).delete();
      await expect(repo.list()).resolves.toHaveLength(0);
    });
  });

  describe('OutboxRepository', () => {
    it('deduplicates by dedupe key', async () => {
      const repo = new OutboxRepository(knex);
      const first = await repo.enqueue({ groupWhatsappId: '1@g.us', body: 'hi', dedupeKey: 'k1' });
      const second = await repo.enqueue({ groupWhatsappId: '1@g.us', body: 'hi', dedupeKey: 'k1' });
      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it('claims due messages and increments attempts', async () => {
      const repo = new OutboxRepository(knex);
      await repo.enqueue({ groupWhatsappId: '1@g.us', body: 'hi' });
      const [claimed] = await repo.claimBatch(10);
      expect(claimed.status).toBe('sending');
      expect(claimed.attempts).toBe(1);
      await expect(repo.claimBatch(10)).resolves.toHaveLength(0);
    });

    it('does not claim messages scheduled in the future', async () => {
      const repo = new OutboxRepository(knex);
      await repo.enqueue({
        groupWhatsappId: '1@g.us',
        body: 'later',
        notBefore: new Date(Date.now() + 60_000).toISOString(),
      });
      await expect(repo.claimBatch(10)).resolves.toHaveLength(0);
    });

    it('reports queue statistics', async () => {
      const repo = new OutboxRepository(knex);
      const a = await repo.enqueue({ groupWhatsappId: '1@g.us', body: 'a' });
      const b = await repo.enqueue({ groupWhatsappId: '1@g.us', body: 'b' });
      await repo.markSent(a!.id);
      await repo.markFailed(b!.id, 'nope');
      const stats = await repo.stats();
      expect(stats).toMatchObject({ pending: 0, failed: 1, sentLastHour: 1 });
    });
  });

  describe('LogRepository', () => {
    it('stores structured details as JSON', async () => {
      const repo = new LogRepository(knex);
      const row = await repo.add('message_sent', { outboxId: 4 });
      expect(row.details).toContain('outboxId');
    });

    it('filters by level and prunes to a retention limit', async () => {
      const repo = new LogRepository(knex);
      for (let i = 0; i < 12; i += 1) await repo.add('tick', { i }, i % 2 ? 'warn' : 'info');
      const warns = await repo.query({ level: 'warn' });
      expect(warns.total).toBe(6);
      await repo.prune(5);
      await expect(repo.query({})).resolves.toMatchObject({ total: 5 });
    });
  });

  describe('SettingsRepository', () => {
    it('upserts and reads typed values', async () => {
      const repo = new SettingsRepository(knex);
      await repo.set('ai.enabled', 'true');
      await repo.set('ai.enabled', 'false');
      await expect(repo.getBool('ai.enabled', true)).resolves.toBe(false);
      await expect(repo.getNumber('missing', 7)).resolves.toBe(7);
    });
  });

  describe('ActivityRepository', () => {
    it('ignores bot messages when computing the last human message', async () => {
      const groupId = await insertGroup(knex);
      const repo = new ActivityRepository(knex);
      await repo.record({ groupId, whatsappId: '1@g.us', body: 'human', timestamp: '2026-07-01T10:00:00.000Z' });
      await repo.record({
        groupId,
        whatsappId: '1@g.us',
        body: 'bot',
        isFromBot: true,
        timestamp: '2026-07-02T10:00:00.000Z',
      });
      await expect(repo.lastHumanMessageAt(groupId)).resolves.toBe('2026-07-01T10:00:00.000Z');
    });

    it('ranks top contributors', async () => {
      const groupId = await insertGroup(knex);
      const repo = new ActivityRepository(knex);
      const now = new Date().toISOString();
      await repo.record({ groupId, whatsappId: '1@g.us', authorId: 'a', authorName: 'Asha', timestamp: now });
      await repo.record({ groupId, whatsappId: '1@g.us', authorId: 'a', authorName: 'Asha', timestamp: now });
      await repo.record({ groupId, whatsappId: '1@g.us', authorId: 'b', authorName: 'Bo', timestamp: now });
      const top = await repo.topContributors(groupId, '2000-01-01T00:00:00.000Z');
      expect(top[0]).toMatchObject({ authorName: 'Asha', messages: 2 });
    });
  });

  describe('HolidayRepository', () => {
    it('finds seeded holidays by date', async () => {
      await seedTestDb(knex);
      const repo = new HolidayRepository(knex);
      await expect(repo.isHoliday('2026-08-15')).resolves.toMatchObject({ name: 'Independence Day' });
      await expect(repo.isHoliday('2026-08-16')).resolves.toBeNull();
    });
  });
});
