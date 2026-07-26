import type { Knex } from 'knex';
import { createTestDb, destroyTestDb, insertGroup } from '../helpers/testDb';
import { FakeGateway } from '../helpers/fakeGateway';
import { MessageQueue } from '../../src/whatsapp/messageQueue';
import { OutboxRepository } from '../../src/repositories/outboxRepository';
import { RateLimiter } from '../../src/utils/rateLimiter';

describe('MessageQueue', () => {
  let knex: Knex;
  let gateway: FakeGateway;
  let outbox: OutboxRepository;
  let queue: MessageQueue;

  beforeEach(async () => {
    knex = await createTestDb();
    gateway = new FakeGateway();
    outbox = new OutboxRepository(knex);
    queue = new MessageQueue({ gateway, outbox });
  });

  afterEach(async () => {
    queue.stop();
    await destroyTestDb(knex);
  });

  it('delivers queued messages through the gateway', async () => {
    await insertGroup(knex);
    await queue.enqueue({ groupWhatsappId: '123456789@g.us', body: 'Good morning' });
    await queue.drain();

    expect(gateway.sent).toHaveLength(1);
    expect(gateway.sent[0].body).toBe('Good morning');
    await expect(outbox.stats()).resolves.toMatchObject({ pending: 0, sentLastHour: 1 });
  });

  it('retries transient failures with backoff instead of dropping them', async () => {
    gateway.failNextSends = 1;
    const record = await queue.enqueue({ groupWhatsappId: '1@g.us', body: 'retry me' });
    await queue.drain();

    const after = await outbox.findById(record!.id);
    expect(after?.status).toBe('pending');
    expect(after?.attempts).toBe(1);
    expect(after?.lastError).toContain('simulated send failure');
    expect(new Date(after!.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('marks a message failed once attempts are exhausted', async () => {
    gateway.failNextSends = 5;
    const record = await queue.enqueue({ groupWhatsappId: '1@g.us', body: 'doomed', maxAttempts: 1 });
    await queue.drain();
    await expect(outbox.findById(record!.id)).resolves.toMatchObject({ status: 'failed' });
  });

  it('never sends the same dedupe key twice', async () => {
    await queue.enqueue({ groupWhatsappId: '1@g.us', body: 'once', dedupeKey: 'daily:2026-07-26' });
    await queue.enqueue({ groupWhatsappId: '1@g.us', body: 'once', dedupeKey: 'daily:2026-07-26' });
    await queue.drain();
    expect(gateway.sent).toHaveLength(1);
  });

  it('defers messages when the rate limit is exhausted', async () => {
    const limiter = new RateLimiter({ capacity: 1, windowMs: 60_000 });
    const limitedQueue = new MessageQueue({ gateway, outbox, rateLimiter: limiter });
    await limitedQueue.enqueue({ groupWhatsappId: '1@g.us', body: 'first' });
    await limitedQueue.enqueue({ groupWhatsappId: '1@g.us', body: 'second' });
    await limitedQueue.drain();

    expect(gateway.sent).toHaveLength(1);
    await expect(outbox.stats()).resolves.toMatchObject({ pending: 1 });
  });

  it('does not send while WhatsApp is disconnected', async () => {
    gateway.status = 'disconnected';
    await queue.enqueue({ groupWhatsappId: '1@g.us', body: 'offline' });
    await expect(queue.drain()).resolves.toBe(0);
    expect(gateway.sent).toHaveLength(0);
  });

  it('re-queues messages stranded in "sending" by a crash', async () => {
    const record = await queue.enqueue({ groupWhatsappId: '1@g.us', body: 'stranded' });
    await outbox.claimBatch(1);
    await knex('outbox')
      .where({ id: record!.id })
      .update({ created_at: new Date(Date.now() - 300_000).toISOString() });

    await expect(outbox.requeueStale(60_000)).resolves.toBe(1);
    await queue.drain();
    expect(gateway.sent).toHaveLength(1);
  });
});
