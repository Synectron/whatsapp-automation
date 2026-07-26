/**
 * whatsapp-web.js client wrapper.
 *
 * Responsibilities: QR handling, session persistence via LocalAuth, connection
 * state machine, automatic reconnection with exponential backoff, and a narrow
 * send/fetch surface exposed through {@link WhatsAppGateway}.
 */
import QRCode from 'qrcode';
import { Client, LocalAuth, type Message } from 'whatsapp-web.js';
import { config } from '../config';
import { ensureDir } from '../config/env';
import { childLogger } from '../utils/logger';
import { eventBus } from '../utils/events';
import { backoffDelay, sleep } from '../utils/async';
import { ServiceUnavailableError } from '../utils/errors';
import type { ConnectionStatus } from '../models/types';
import type { RemoteGroup, SendOptions, WhatsAppGateway } from './gateway';

const log = childLogger('whatsapp');

/** whatsapp-web.js marks group chats with the `@g.us` suffix. */
export const isGroupId = (id: string): boolean => id.endsWith('@g.us');

export class WhatsAppClient implements WhatsAppGateway {
  private client: Client | null = null;
  private currentStatus: ConnectionStatus = 'stopped';
  private qrDataUrl: string | null = null;
  private lastQrAt: string | undefined;
  private connectedSince: string | undefined;
  private reconnectAttempts = 0;
  private shuttingDown = false;
  private initPromise: Promise<void> | null = null;

  public get status(): ConnectionStatus {
    return this.currentStatus;
  }

  public get isReady(): boolean {
    return this.currentStatus === 'ready';
  }

  public getQrDataUrl(): string | null {
    return this.qrDataUrl;
  }

  public getInfo() {
    return {
      pushname: this.client?.info?.pushname,
      wid: this.client?.info?.wid?._serialized,
      connectedSince: this.connectedSince,
      reconnectAttempts: this.reconnectAttempts,
      lastQrAt: this.lastQrAt,
    };
  }

  private setStatus(status: ConnectionStatus, detail?: string): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    log.info('Connection status changed', { status, detail });
    eventBus.emit('wa:status', { status, detail });
  }

  private buildClient(): Client {
    ensureDir(config.whatsapp.sessionPath);
    return new Client({
      authStrategy: new LocalAuth({
        clientId: config.whatsapp.clientId,
        dataPath: config.whatsapp.sessionPath,
      }),
      puppeteer: {
        headless: config.whatsapp.headless,
        args: config.whatsapp.puppeteerArgs,
        ...(config.whatsapp.executablePath ? { executablePath: config.whatsapp.executablePath } : {}),
      },
      // Pin the web build so a WhatsApp Web update cannot silently break auth.
      takeoverOnConflict: true,
      takeoverTimeoutMs: 10_000,
    });
  }

  private registerHandlers(client: Client): void {
    client.on('qr', (qr: string) => {
      void (async () => {
        this.lastQrAt = new Date().toISOString();
        this.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
        this.setStatus('qr', 'Scan the QR code from WhatsApp → Linked devices');
        eventBus.emit('wa:qr', { qr, dataUrl: this.qrDataUrl, generatedAt: this.lastQrAt });
      })();
    });

    client.on('authenticated', () => {
      this.qrDataUrl = null;
      this.setStatus('authenticated');
      eventBus.emit('wa:authenticated', {});
    });

    client.on('auth_failure', (message: string) => {
      this.setStatus('auth_failure', message);
      eventBus.emit('wa:auth_failure', { message });
    });

    client.on('ready', () => {
      this.qrDataUrl = null;
      this.reconnectAttempts = 0;
      this.connectedSince = new Date().toISOString();
      this.setStatus('ready');
      eventBus.emit('wa:ready', {
        pushname: client.info?.pushname,
        wid: client.info?.wid?._serialized,
      });
    });

    client.on('disconnected', (reason: string) => {
      this.connectedSince = undefined;
      this.setStatus('disconnected', String(reason));
      eventBus.emit('wa:disconnected', { reason: String(reason) });
      void this.scheduleReconnect();
    });

    const handleMessage = (message: Message) => {
      void (async () => {
        try {
          const chat = await message.getChat();
          if (!chat.isGroup) return;
          let authorName = '';
          try {
            const contact = await message.getContact();
            authorName = contact.pushname || contact.name || contact.number || '';
          } catch {
            authorName = '';
          }
          eventBus.emit('wa:message', {
            messageId: message.id?._serialized ?? '',
            chatId: chat.id._serialized,
            chatName: chat.name,
            authorId: message.author ?? message.from,
            authorName,
            body: message.body ?? '',
            isGroup: true,
            fromMe: Boolean(message.fromMe),
            timestamp: new Date((message.timestamp ?? Date.now() / 1000) * 1000).toISOString(),
          });
        } catch (err) {
          log.warn('Failed to process inbound message', { error: (err as Error).message });
        }
      })();
    };

    client.on('message', handleMessage);
    // `message_create` also fires for our own messages, which we need in order
    // to keep activity tracking honest about who last spoke.
    client.on('message_create', (message: Message) => {
      if (message.fromMe) handleMessage(message);
    });
  }

  public async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.shuttingDown = false;
    this.initPromise = (async () => {
      this.setStatus('initializing');
      this.client = this.buildClient();
      this.registerHandlers(this.client);
      try {
        await this.client.initialize();
      } catch (err) {
        const message = (err as Error).message;
        log.error('WhatsApp initialization failed', { error: message });
        this.setStatus('disconnected', message);
        this.initPromise = null;
        await this.scheduleReconnect();
        return;
      }
      this.initPromise = null;
    })();
    return this.initPromise;
  }

  /** Reconnects with exponential backoff, bounded by config. */
  private async scheduleReconnect(): Promise<void> {
    if (this.shuttingDown) return;
    if (this.reconnectAttempts >= config.whatsapp.maxReconnectAttempts) {
      log.error('Maximum reconnect attempts reached — manual restart required', {
        attempts: this.reconnectAttempts,
      });
      this.setStatus('stopped', 'Maximum reconnect attempts reached');
      return;
    }
    this.reconnectAttempts += 1;
    const delay = backoffDelay(
      this.reconnectAttempts,
      config.whatsapp.reconnectDelayMs,
      Math.max(config.whatsapp.reconnectDelayMs, 300_000),
      2,
      true,
    );
    this.setStatus('reconnecting', `Attempt ${this.reconnectAttempts} in ${Math.round(delay / 1000)}s`);
    await sleep(delay);
    if (this.shuttingDown) return;
    try {
      await this.client?.destroy().catch(() => undefined);
    } finally {
      this.client = null;
    }
    await this.initialize();
  }

  public async restart(): Promise<void> {
    log.info('Restarting WhatsApp client');
    await this.destroy();
    this.reconnectAttempts = 0;
    await this.initialize();
  }

  public async destroy(): Promise<void> {
    this.shuttingDown = true;
    this.initPromise = null;
    if (this.client) {
      await this.client.destroy().catch((err) => log.warn('Error during destroy', { error: err.message }));
      this.client = null;
    }
    this.connectedSince = undefined;
    this.setStatus('stopped');
  }

  public async logout(): Promise<void> {
    if (!this.client) throw new ServiceUnavailableError('WhatsApp client is not running');
    await this.client.logout();
    this.qrDataUrl = null;
    this.connectedSince = undefined;
    this.setStatus('disconnected', 'Logged out');
  }

  public async sendMessage(chatId: string, body: string, options: SendOptions = {}): Promise<string> {
    if (config.whatsapp.dryRun) {
      log.warn('DRY RUN — message not delivered', { chatId, preview: body.slice(0, 80) });
      return `dry-run-${Date.now()}`;
    }
    if (!this.client || !this.isReady) {
      throw new ServiceUnavailableError(`WhatsApp client is not ready (status: ${this.currentStatus})`);
    }
    const sent = await this.client.sendMessage(chatId, body, {
      ...(options.mentions?.length ? { mentions: options.mentions } : {}),
    } as never);
    return sent?.id?._serialized ?? '';
  }

  public async fetchGroups(): Promise<RemoteGroup[]> {
    if (!this.client || !this.isReady) {
      throw new ServiceUnavailableError(`WhatsApp client is not ready (status: ${this.currentStatus})`);
    }
    // getChats() is broken on current WhatsApp Web builds (wwebjs #5733):
    // full-chat serialization throws inside the page. Read the group models
    // straight from the injected Store instead and return plain objects.
    const page = (this.client as unknown as { pupPage?: import('puppeteer').Page }).pupPage;
    if (!page) {
      throw new ServiceUnavailableError('WhatsApp browser page is not available');
    }
    const groups = (await page.evaluate(() => {
      const store = (globalThis as unknown as {
        Store: {
          Chat: {
            getModelsArray: () => Array<{
              isGroup?: boolean;
              id: { _serialized: string; server?: string };
              formattedTitle?: string;
              name?: string;
              groupMetadata?: {
                desc?: string;
                participants?: {
                  getModelsArray: () => Array<{
                    id: { _serialized: string };
                    isAdmin?: boolean;
                    isSuperAdmin?: boolean;
                  }>;
                };
              };
            }>;
          };
        };
      }).Store;
      return store.Chat.getModelsArray()
        .filter((chat) => chat.isGroup || chat.id.server === 'g.us')
        .map((chat) => ({
          whatsappId: chat.id._serialized,
          name: chat.formattedTitle ?? chat.name ?? chat.id._serialized,
          description: chat.groupMetadata?.desc ?? null,
          participants: (chat.groupMetadata?.participants?.getModelsArray() ?? []).map((p) => ({
            id: p.id._serialized,
            isAdmin: Boolean(p.isAdmin) || Boolean(p.isSuperAdmin),
          })),
        }));
    })) as Array<{
      whatsappId: string;
      name: string;
      description: string | null;
      participants: Array<{ id: string; isAdmin: boolean }>;
    }>;

    return groups.map((group) => ({
      ...group,
      participantCount: group.participants.length || null,
    }));
  }
}

export const whatsappClient = new WhatsAppClient();
