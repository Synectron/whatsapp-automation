/** In-memory WhatsApp gateway double. */
import type { ConnectionStatus } from '../../src/models/types';
import type { RemoteGroup, ResolvedNumber, SendOptions, WhatsAppGateway } from '../../src/whatsapp/gateway';

export class FakeGateway implements WhatsAppGateway {
  public status: ConnectionStatus = 'ready';
  public sent: Array<{ chatId: string; body: string; options: SendOptions }> = [];
  public groups: RemoteGroup[] = [];
  public failNextSends = 0;

  get isReady(): boolean {
    return this.status === 'ready';
  }

  async initialize(): Promise<void> {
    this.status = 'ready';
  }

  async destroy(): Promise<void> {
    this.status = 'stopped';
  }

  async logout(): Promise<void> {
    this.status = 'disconnected';
  }

  async restart(): Promise<void> {
    this.status = 'ready';
  }

  async sendMessage(chatId: string, body: string, options: SendOptions = {}): Promise<string> {
    if (this.failNextSends > 0) {
      this.failNextSends -= 1;
      throw new Error('simulated send failure');
    }
    this.sent.push({ chatId, body, options });
    return `msg-${this.sent.length}`;
  }

  async fetchGroups(): Promise<RemoteGroup[]> {
    return this.groups;
  }

  /** Numbers listed here are treated as not having a WhatsApp account. */
  public unregisteredNumbers: string[] = [];

  async resolveNumber(digits: string): Promise<ResolvedNumber> {
    return {
      chatId: `${digits}@c.us`,
      registered: !this.unregisteredNumbers.includes(digits),
    };
  }

  getQrDataUrl(): string | null {
    return this.status === 'qr' ? 'data:image/png;base64,fake' : null;
  }

  getInfo() {
    return { pushname: 'Test Bot', wid: '111@c.us', reconnectAttempts: 0 };
  }
}
