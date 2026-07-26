/**
 * Typed application event bus. Keeps WhatsApp, scheduler, AI and the dashboard
 * decoupled: producers emit, consumers subscribe, nobody imports each other.
 */
import { EventEmitter } from 'node:events';
import type { ConnectionStatus, InboundMessage } from '../models/types';

export interface AppEvents {
  'wa:qr': { qr: string; dataUrl: string; generatedAt: string };
  'wa:status': { status: ConnectionStatus; detail?: string };
  'wa:ready': { pushname?: string; wid?: string };
  'wa:authenticated': Record<string, never>;
  'wa:auth_failure': { message: string };
  'wa:disconnected': { reason: string };
  'wa:message': InboundMessage;
  'queue:sent': { outboxId: number; groupId: string };
  'queue:failed': { outboxId: number; groupId: string; error: string; attempts: number };
  'log:created': { id: number; event: string; level: string; details?: string };
}

export type AppEventName = keyof AppEvents;

class TypedEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Many subscribers (queue, scheduler, AI, SSE clients) are expected.
    this.emitter.setMaxListeners(100);
  }

  emit<K extends AppEventName>(event: K, payload: AppEvents[K]): void {
    this.emitter.emit(event, payload);
  }

  on<K extends AppEventName>(event: K, listener: (payload: AppEvents[K]) => void): () => void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return () => this.off(event, listener);
  }

  once<K extends AppEventName>(event: K, listener: (payload: AppEvents[K]) => void): void {
    this.emitter.once(event, listener as (...args: unknown[]) => void);
  }

  off<K extends AppEventName>(event: K, listener: (payload: AppEvents[K]) => void): void {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
  }

  removeAll(): void {
    this.emitter.removeAllListeners();
  }
}

export const eventBus = new TypedEventBus();
