/**
 * Outgoing message worker.
 *
 * Reads due rows from the durable `outbox` table, applies a token-bucket rate
 * limit, sends via the gateway and reschedules failures with exponential
 * backoff until `maxAttempts` is exhausted.
 */
import { config } from '../config';
import { childLogger } from '../utils/logger';
import { eventBus } from '../utils/events';
import { backoffDelay } from '../utils/async';
import { RateLimiter } from '../utils/rateLimiter';
import { OutboxRepository } from '../repositories/outboxRepository';
import { LogRepository } from '../repositories/logRepository';
import type { WhatsAppGateway } from './gateway';
import type { EnqueueInput } from '../repositories/outboxRepository';
import type { OutboxRecord } from '../models/types';

const log = childLogger('message-queue');

export interface MessageQueueDeps {
  gateway: WhatsAppGateway;
  outbox?: OutboxRepository;
  logs?: LogRepository;
  rateLimiter?: RateLimiter;
}

export class MessageQueue {
  private readonly gateway: WhatsAppGateway;
  private readonly outbox: OutboxRepository;
  private readonly logs: LogRepository;
  private readonly limiter: RateLimiter;
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(deps: MessageQueueDeps) {
    this.gateway = deps.gateway;
    this.outbox = deps.outbox ?? new OutboxRepository();
    this.logs = deps.logs ?? new LogRepository();
    this.limiter =
      deps.rateLimiter ??
      new RateLimiter({
        capacity: config.queue.rateLimit.messages,
        windowMs: config.queue.rateLimit.windowMs,
        minGapMs: config.queue.rateLimit.minGapMs,
      });
  }

  /** Adds a message to the durable queue. Returns null when deduplicated. */
  public async enqueue(input: EnqueueInput): Promise<OutboxRecord | null> {
    const record = await this.outbox.enqueue({
      ...input,
      maxAttempts: input.maxAttempts ?? config.queue.maxAttempts,
    });
    if (record) {
      log.debug('Message queued', { id: record.id, group: record.groupWhatsappId, source: record.source });
    } else {
      log.debug('Message skipped (duplicate dedupe key)', { dedupeKey: input.dedupeKey });
    }
    return record;
  }

  public start(): void {
    if (this.timer) return;
    // Anything left in `sending` belongs to a previous, crashed process.
    void this.outbox.requeueStale(60_000).catch((err) => log.warn('Requeue stale failed', { error: err.message }));
    this.timer = setInterval(() => void this.drain(), config.queue.pollIntervalMs);
    this.timer.unref?.();
    log.info('Message queue worker started', { intervalMs: config.queue.pollIntervalMs });
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info('Message queue worker stopped');
    }
  }

  /** Processes every due message, honouring the rate limit. Safe to call directly (tests). */
  public async drain(): Promise<number> {
    if (this.draining) return 0;
    this.draining = true;
    let processed = 0;
    try {
      if (!this.gateway.isReady && !config.whatsapp.dryRun) return 0;

      const batch = await this.outbox.claimBatch(config.queue.rateLimit.messages);
      for (const item of batch) {
        if (!this.limiter.tryConsume()) {
          // Out of tokens: release the claim so it is retried on the next tick.
          await this.outbox.markRetry(
            item.id,
            'rate limited',
            new Date(Date.now() + this.limiter.msUntilAvailable()).toISOString(),
          );
          continue;
        }
        await this.deliver(item);
        processed += 1;
      }
    } catch (err) {
      log.error('Queue drain failed', { error: (err as Error).message });
    } finally {
      this.draining = false;
    }
    return processed;
  }

  private async deliver(item: OutboxRecord): Promise<void> {
    const mentions = item.mentions ? (JSON.parse(item.mentions) as string[]) : undefined;
    try {
      await this.gateway.sendMessage(item.groupWhatsappId, item.body, mentions ? { mentions } : {});
      await this.outbox.markSent(item.id);
      await this.logs.add(
        'message_sent',
        { outboxId: item.id, group: item.groupWhatsappId, source: item.source, preview: item.body.slice(0, 120) },
        'info',
        item.groupId,
      );
      eventBus.emit('queue:sent', { outboxId: item.id, groupId: item.groupWhatsappId });
      log.info('Message sent', { id: item.id, group: item.groupWhatsappId, source: item.source });
    } catch (err) {
      const message = (err as Error).message;
      if (item.attempts >= item.maxAttempts) {
        await this.outbox.markFailed(item.id, message);
        await this.logs.add(
          'message_failed',
          { outboxId: item.id, group: item.groupWhatsappId, attempts: item.attempts, error: message },
          'error',
          item.groupId,
        );
        eventBus.emit('queue:failed', {
          outboxId: item.id,
          groupId: item.groupWhatsappId,
          error: message,
          attempts: item.attempts,
        });
        log.error('Message permanently failed', { id: item.id, attempts: item.attempts, error: message });
        return;
      }
      const delay = backoffDelay(item.attempts, config.queue.baseBackoffMs, config.queue.maxBackoffMs, 2, true);
      await this.outbox.markRetry(item.id, message, new Date(Date.now() + delay).toISOString());
      log.warn('Message delivery failed — will retry', {
        id: item.id,
        attempt: item.attempts,
        retryInMs: delay,
        error: message,
      });
    }
  }

  public stats() {
    return this.outbox.stats();
  }
}
