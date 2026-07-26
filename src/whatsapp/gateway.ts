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

export interface ResolvedNumber {
  /** Canonical chat id reported by WhatsApp (may differ from the input). */
  chatId: string;
  registered: boolean;
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
  /**
   * Checks whether a number has a WhatsApp account and returns its canonical
   * chat id. Sending to unregistered numbers is both useless and a signal that
   * contributes to account restrictions, so callers check first.
   */
  resolveNumber(digits: string): Promise<ResolvedNumber>;
  getQrDataUrl(): string | null;
  getInfo(): { pushname?: string; wid?: string; connectedSince?: string; reconnectAttempts: number; lastQrAt?: string };
}
