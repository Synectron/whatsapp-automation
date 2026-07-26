/**
 * Runtime settings: database values layered on top of the .env defaults so the
 * dashboard can change behaviour without a redeploy.
 */
import { config } from '../config';
import { SettingsRepository } from '../repositories/settingsRepository';
import { audit, AuditEvent } from './auditService';

export interface RuntimeSettings {
  aiEnabled: boolean;
  aiProvider: string;
  aiPersona: string;
  aiAutoReply: boolean;
  aiWeeklySummary: boolean;
  inactivityEnabled: boolean;
  inactivityHours: number;
  inactivityMessage: string;
  motivationEnabled: boolean;
  schedulerEnabled: boolean;
  signature: string;
}

export class SettingsService {
  constructor(private readonly repo: SettingsRepository = new SettingsRepository()) {}

  async get(): Promise<RuntimeSettings> {
    const values = await this.repo.asObject();
    const bool = (key: string, fallback: boolean) =>
      values[key] === undefined ? fallback : /^(1|true|yes|on)$/i.test(values[key]);
    const num = (key: string, fallback: number) => {
      const parsed = Number(values[key]);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    return {
      aiEnabled: bool('ai.enabled', config.ai.enabled),
      aiProvider: values['ai.provider'] ?? config.ai.provider,
      aiPersona: values['ai.persona'] ?? '',
      aiAutoReply: bool('ai.autoReply', true),
      aiWeeklySummary: bool('ai.weeklySummary', config.scheduler.weeklySummary.enabled),
      inactivityEnabled: bool('inactivity.enabled', config.inactivity.enabled),
      inactivityHours: num('inactivity.hours', config.inactivity.hours),
      inactivityMessage:
        values['inactivity.message'] ??
        'Hey everyone 👋\nJust checking in.\nDoes anyone need help?\nAny updates to share?',
      motivationEnabled: bool('motivation.enabled', config.scheduler.motivation.enabled),
      schedulerEnabled: bool('scheduler.enabled', config.scheduler.enabled),
      signature: values['branding.signature'] ?? '',
    };
  }

  async update(patch: Record<string, string>): Promise<RuntimeSettings> {
    await this.repo.setMany(patch);
    await audit.info(AuditEvent.SettingsUpdated, { keys: Object.keys(patch) });
    return this.get();
  }

  raw = this.repo.asObject.bind(this.repo);
  setKey = this.repo.set.bind(this.repo);
  getKey = this.repo.get.bind(this.repo);
}

export const settingsService = new SettingsService();
