import type { Knex } from 'knex';
import { createTestDb, destroyTestDb, insertGroup, seedTestDb } from '../helpers/testDb';
import { FakeGateway } from '../helpers/fakeGateway';
import { MessageQueue } from '../../src/whatsapp/messageQueue';
import { MessageService } from '../../src/services/messageService';
import { GroupService } from '../../src/services/groupService';
import { ActivityService } from '../../src/services/activityService';
import { FollowUpService } from '../../src/services/followUpService';
import { AiService } from '../../src/ai';
import { NoopProvider } from '../../src/ai/noopProvider';
import { OutboxRepository } from '../../src/repositories/outboxRepository';
import type { AiProvider } from '../../src/ai/provider';
import type { InboundMessage } from '../../src/models/types';

class StubProvider implements AiProvider {
  public readonly name = 'stub';
  public readonly isReady = true;
  constructor(private readonly reply: string) {}
  async complete(): Promise<string> {
    return this.reply;
  }
}

const inbound = (body: string, overrides: Partial<InboundMessage> = {}): InboundMessage => ({
  messageId: `m-${Math.random().toString(36).slice(2)}`,
  chatId: '123456789@g.us',
  chatName: 'Test Group',
  authorId: 'user-1@c.us',
  authorName: 'Asha',
  body,
  isGroup: true,
  fromMe: false,
  timestamp: new Date().toISOString(),
  ...overrides,
});

describe('FollowUpService', () => {
  let knex: Knex;
  let gateway: FakeGateway;
  let queue: MessageQueue;
  let groups: GroupService;
  let messages: MessageService;
  let activity: ActivityService;

  const build = (ai: AiService) => new FollowUpService(groups, activity, messages, ai);

  beforeEach(async () => {
    knex = await createTestDb();
    await seedTestDb(knex);
    await insertGroup(knex, { enabled: true });

    gateway = new FakeGateway();
    queue = new MessageQueue({ gateway, outbox: new OutboxRepository(knex) });
    groups = new GroupService(gateway);
    messages = new MessageService(queue, groups);
    activity = new ActivityService(groups);
  });

  afterEach(async () => {
    queue.stop();
    await destroyTestDb(knex);
  });

  it('records inbound activity', async () => {
    await build(new AiService(new NoopProvider())).handle(inbound('just a note here'));
    await expect(knex('group_activity').count({ c: '*' }).first()).resolves.toMatchObject({ c: 1 });
  });

  it('asks a blocked member to share details (rule-based, AI off)', async () => {
    await build(new AiService(new NoopProvider())).handle(inbound("I'm blocked on the API work"));
    await queue.drain();
    expect(gateway.sent[0].body).toContain("what you're blocked on");
  });

  it('offers a follow-up reminder when someone is waiting', async () => {
    await build(new AiService(new NoopProvider())).handle(inbound('Waiting for API credentials.'));
    await queue.drain();
    expect(gateway.sent[0].body).toContain('remind the group again tomorrow');
  });

  it('stays silent on neutral chatter', async () => {
    await build(new AiService(new NoopProvider())).handle(inbound('sounds good to me thanks'));
    await queue.drain();
    expect(gateway.sent).toHaveLength(0);
  });

  it('ignores very short messages', async () => {
    await build(new AiService(new NoopProvider())).handle(inbound('ok'));
    await queue.drain();
    expect(gateway.sent).toHaveLength(0);
  });

  it('uses the AI provider when enabled', async () => {
    await knex('settings').where({ key: 'ai.enabled' }).update({ value: 'true' });
    await build(new AiService(new StubProvider('Noted. I will check back tomorrow.'))).handle(
      inbound('Waiting for API credentials.'),
    );
    await queue.drain();
    expect(gateway.sent[0].body).toBe('Noted. I will check back tomorrow.');
  });

  it('respects a SKIP response from the model', async () => {
    await knex('settings').where({ key: 'ai.enabled' }).update({ value: 'true' });
    await build(new AiService(new StubProvider('SKIP'))).handle(inbound('Deployed the new build.'));
    await queue.drain();
    expect(gateway.sent).toHaveLength(0);
  });

  it('never replies to its own messages', async () => {
    await build(new AiService(new NoopProvider())).handle(inbound("I'm blocked on something", { fromMe: true }));
    await queue.drain();
    expect(gateway.sent).toHaveLength(0);
  });

  it('does nothing for groups that are not enabled', async () => {
    await knex('groups').update({ enabled: false });
    await build(new AiService(new NoopProvider())).handle(inbound("I'm blocked on the API work"));
    await queue.drain();
    expect(gateway.sent).toHaveLength(0);
  });
});
