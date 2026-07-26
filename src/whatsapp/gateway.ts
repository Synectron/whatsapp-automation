/**
 * Transport abstraction over WhatsApp.
 *
 * Everything downstream (queue, scheduler, services) depends on this interface
 * rather than on whatsapp-web.js directly — dependency inversion that keeps the
 * business logic testable without a browser.
 */
import type { ConnectionStatus } from '../models/types';

export interface RemoteGroup {
  whatsappId: string;
  name: string;
  description?: string | null;
  participantCount?: number | null;
  participants?: Array<{ id: string; isAdmin: boolean }>;
}

export interface SendOptions {
  /** Serialized participant ids to @-mention. */
  mentions?: string[];
}

export interface WhatsAppGateway {
  readonly status: ConnectionStatus;
  readonly isReady: boolean;
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  logout(): Promise<void>;
  restart(): Promise<void>;
  sendMessage(chatId: string, body: string, options?: SendOptions): Promise<string>;
  fetchGroups(): Promise<RemoteGroup[]>;
  getQrDataUrl(): string | null;
  getInfo(): { pushname?: string; wid?: string; connectedSince?: string; reconnectAttempts: number; lastQrAt?: string };
}
