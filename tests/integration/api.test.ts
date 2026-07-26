import request from 'supertest';
import type { Knex } from 'knex';
import type { Express } from 'express';
import { createTestDb, destroyTestDb, insertGroup, seedTestDb } from '../helpers/testDb';
import { FakeGateway } from '../helpers/fakeGateway';
import { createApp } from '../../src/app';
import { buildContainer, type Container } from '../../src/container';

const API_KEY = 'test-api-key';

describe('REST API', () => {
  let knex: Knex;
  let app: Express;
  let container: Container;
  let gateway: FakeGateway;
  let groupId: number;

  beforeEach(async () => {
    knex = await createTestDb();
    await seedTestDb(knex);
    groupId = await insertGroup(knex, { enabled: true });
    gateway = new FakeGateway();
    container = buildContainer({ gateway });
    app = createApp(container, { ephemeralSessions: true });
  });

  afterEach(async () => {
    container.queue.stop();
    container.scheduler.stop();
    await destroyTestDb(knex);
  });

  describe('authentication', () => {
    it('rejects unauthenticated calls', async () => {
      const res = await request(app).get('/api/groups');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('accepts a valid API key', async () => {
      const res = await request(app).get('/api/groups').set('X-API-Key', API_KEY);
      expect(res.status).toBe(200);
    });

    it('rejects a wrong API key', async () => {
      const res = await request(app).get('/api/groups').set('X-API-Key', 'nope');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /healthz', () => {
    it('is public and reports database health', async () => {
      const res = await request(app).get('/healthz');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('GET /api/status', () => {
    it('returns a connection snapshot', async () => {
      const res = await request(app).get('/api/status').set('X-API-Key', API_KEY);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ status: 'ready', connected: true });
      expect(res.body.data.queue).toBeDefined();
    });
  });

  describe('GET /api/groups', () => {
    it('lists stored groups', async () => {
      const res = await request(app).get('/api/groups').set('X-API-Key', API_KEY);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({ name: 'Test Group', enabled: true });
    });

    it('toggles a group', async () => {
      const res = await request(app)
        .patch(`/api/groups/${groupId}`)
        .set('X-API-Key', API_KEY)
        .send({ enabled: false });
      expect(res.body.data.enabled).toBe(false);
    });

    it('404s for an unknown group', async () => {
      const res = await request(app).get('/api/groups/9999').set('X-API-Key', API_KEY);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/message', () => {
    it('queues and delivers a message', async () => {
      const res = await request(app)
        .post('/api/message')
        .set('X-API-Key', API_KEY)
        .send({ groupId, message: 'Hello team' });

      expect(res.status).toBe(201);
      expect(res.body.data.queued).toBe(true);

      await container.queue.drain();
      expect(gateway.sent[0].body).toBe('Hello team');
    });

    it('rejects an empty body', async () => {
      const res = await request(app)
        .post('/api/message')
        .set('X-API-Key', API_KEY)
        .send({ groupId, message: '' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('requires a target', async () => {
      const res = await request(app).post('/api/message').set('X-API-Key', API_KEY).send({ message: 'hi' });
      expect(res.status).toBe(400);
    });

    it('rejects a malformed whatsappId', async () => {
      const res = await request(app)
        .post('/api/message')
        .set('X-API-Key', API_KEY)
        .send({ whatsappId: 'not-an-id', message: 'hi' });
      expect(res.status).toBe(400);
    });
  });

  describe('schedules', () => {
    it('creates, lists, runs and deletes a schedule', async () => {
      const created = await request(app)
        .post('/api/schedule')
        .set('X-API-Key', API_KEY)
        .send({ groupId, name: 'Daily check-in', cron: '30 9 * * *', message: 'Good morning 👋' });

      expect(created.status).toBe(201);
      expect(created.body.data.description).toBe('Every day at 09:30');
      const id = created.body.data.id;

      const listed = await request(app).get('/api/schedule').set('X-API-Key', API_KEY);
      expect(listed.body.data).toHaveLength(1);

      const run = await request(app).post(`/api/schedule/${id}/run`).set('X-API-Key', API_KEY);
      expect(run.body.data.result).toBe('queued');

      const removed = await request(app).delete(`/api/schedule/${id}`).set('X-API-Key', API_KEY);
      expect(removed.body.data.deleted).toBe(true);
      await expect(request(app).get(`/api/schedule/${id}`).set('X-API-Key', API_KEY)).resolves.toMatchObject({
        status: 404,
      });
    });

    it('rejects an invalid cron expression', async () => {
      const res = await request(app)
        .post('/api/schedule')
        .set('X-API-Key', API_KEY)
        .send({ groupId, name: 'Bad', cron: '99 99 * * *', message: 'nope' });
      expect(res.status).toBe(400);
    });

    it('validates cron expressions on demand', async () => {
      const res = await request(app)
        .post('/api/schedule/validate-cron')
        .set('X-API-Key', API_KEY)
        .send({ cron: '0 17 * * 5' });
      expect(res.body.data).toMatchObject({ valid: true, description: 'Every Friday at 17:00' });
    });

    it('creates a one-shot meeting reminder', async () => {
      const startsAt = new Date(Date.now() + 2 * 3_600_000).toISOString();
      const res = await request(app)
        .post('/api/schedule/meeting')
        .set('X-API-Key', API_KEY)
        .send({ groupId, title: 'Sprint planning', startsAt, minutesBefore: 30 });

      expect(res.status).toBe(201);
      expect(res.body.data.runOnce).toBe(true);
      expect(res.body.data.message).toContain('Sprint planning starts in 30 minutes');
    });

    it('refuses a meeting reminder in the past', async () => {
      const res = await request(app)
        .post('/api/schedule/meeting')
        .set('X-API-Key', API_KEY)
        .send({ groupId, title: 'Old', startsAt: new Date(Date.now() - 3_600_000).toISOString() });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/logs', () => {
    it('returns paginated log entries', async () => {
      await container.audit.info('test_event', { hello: 'world' });
      const res = await request(app).get('/api/logs?limit=10').set('X-API-Key', API_KEY);
      expect(res.body.data.items.length).toBeGreaterThan(0);
      expect(res.body.data.total).toBeGreaterThan(0);
    });

    it('rejects an out-of-range limit', async () => {
      const res = await request(app).get('/api/logs?limit=99999').set('X-API-Key', API_KEY);
      expect(res.status).toBe(400);
    });
  });

  describe('settings', () => {
    it('reads and updates runtime settings', async () => {
      const before = await request(app).get('/api/settings').set('X-API-Key', API_KEY);
      expect(before.body.data).toHaveProperty('aiEnabled');

      const after = await request(app)
        .put('/api/settings')
        .set('X-API-Key', API_KEY)
        .send({ 'inactivity.hours': '12' });
      expect(after.body.data.inactivityHours).toBe(12);
    });
  });

  describe('analytics', () => {
    it('exports chat statistics as CSV', async () => {
      const res = await request(app).get('/api/analytics/export?days=7').set('X-API-Key', API_KEY);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text.split('\n')[0]).toContain('group_id,group_name');
    });
  });

  describe('unknown routes', () => {
    it('returns a JSON 404 under /api', async () => {
      const res = await request(app).get('/api/does-not-exist').set('X-API-Key', API_KEY);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
