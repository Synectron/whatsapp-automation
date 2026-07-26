import request from 'supertest';
import type { Knex } from 'knex';
import type { Express } from 'express';
import { createTestDb, destroyTestDb, insertGroup, seedTestDb } from '../helpers/testDb';
import { FakeGateway } from '../helpers/fakeGateway';
import { createApp } from '../../src/app';
import { buildContainer, type Container } from '../../src/container';

const API_KEY = 'test-api-key';

describe('individual (non-group) recipients', () => {
  let knex: Knex;
  let app: Express;
  let container: Container;
  let gateway: FakeGateway;

  beforeEach(async () => {
    knex = await createTestDb();
    await seedTestDb(knex);
    await insertGroup(knex, { enabled: true });
    gateway = new FakeGateway();
    container = buildContainer({ gateway });
    app = createApp(container, { ephemeralSessions: true });
  });

  afterEach(async () => {
    container.queue.stop();
    container.scheduler.stop();
    await destroyTestDb(knex);
  });

  describe('MessageService', () => {
    it('sends to a typed phone number', async () => {
      const record = await container.messages.send({ phone: '+91 98765 43210', message: 'Hi there' });
      expect(record).not.toBeNull();

      await container.queue.drain();
      expect(gateway.sent).toHaveLength(1);
      expect(gateway.sent[0].chatId).toBe('919876543210@c.us');
      expect(gateway.sent[0].body).toBe('Hi there');
    });

    it('refuses a number with no WhatsApp account', async () => {
      gateway.unregisteredNumbers = ['919876543210'];
      await expect(
        container.messages.send({ phone: '+919876543210', message: 'Hi' }),
      ).rejects.toThrow(/does not have a WhatsApp account/);
      expect(gateway.sent).toHaveLength(0);
    });

    it('rejects an unparseable number', async () => {
      await expect(container.messages.send({ phone: 'not-a-number', message: 'Hi' })).rejects.toThrow(
        /letters/i,
      );
    });

    it('still requires some recipient', async () => {
      await expect(container.messages.send({ message: 'Hi' })).rejects.toThrow(/groupId, whatsappId or phone/);
    });

    it('applies the rate limit and queue to direct messages too', async () => {
      const record = await container.messages.send({ phone: '9876543210', message: 'Queued like anything else' });
      expect(record?.status).toBe('pending');
      expect(gateway.sent).toHaveLength(0); // nothing sent until the worker runs
      await container.queue.drain();
      expect(gateway.sent).toHaveLength(1);
    });
  });

  describe('POST /api/message', () => {
    it('accepts a phone number', async () => {
      const res = await request(app)
        .post('/api/message')
        .set('X-API-Key', API_KEY)
        .send({ phone: '+91 98765 43210', message: 'Hello' });

      expect(res.status).toBe(201);
      await container.queue.drain();
      expect(gateway.sent[0].chatId).toBe('919876543210@c.us');
    });

    it('rejects a request with no recipient at all', async () => {
      const res = await request(app).post('/api/message').set('X-API-Key', API_KEY).send({ message: 'Hello' });
      expect(res.status).toBe(400);
    });

    it('reports an unregistered number as a validation error', async () => {
      gateway.unregisteredNumbers = ['919876543210'];
      const res = await request(app)
        .post('/api/message')
        .set('X-API-Key', API_KEY)
        .send({ phone: '919876543210', message: 'Hello' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/does not have a WhatsApp account/);
    });
  });

  describe('POST /api/message/validate-number', () => {
    it('confirms a valid, registered number', async () => {
      const res = await request(app)
        .post('/api/message/validate-number')
        .set('X-API-Key', API_KEY)
        .send({ phone: '+91 98765 43210' });

      expect(res.body.data).toMatchObject({
        valid: true,
        display: '+919876543210',
        chatId: '919876543210@c.us',
        registered: true,
      });
    });

    it('flags a number that is not on WhatsApp', async () => {
      gateway.unregisteredNumbers = ['919876543210'];
      const res = await request(app)
        .post('/api/message/validate-number')
        .set('X-API-Key', API_KEY)
        .send({ phone: '919876543210' });

      expect(res.body.data).toMatchObject({ valid: true, registered: false });
    });

    it('reports unparseable input without throwing', async () => {
      const res = await request(app)
        .post('/api/message/validate-number')
        .set('X-API-Key', API_KEY)
        .send({ phone: 'abcdefg' });

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(false);
    });
  });
});
