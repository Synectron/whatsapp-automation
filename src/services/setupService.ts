/**
 * First-boot setup.
 *
 * When no dashboard password is supplied through the environment, the app
 * starts in "setup" mode: a guided wizard creates the admin account, chooses a
 * timezone, links WhatsApp and enables the first groups. Credentials created
 * this way are stored (bcrypt-hashed) in the `settings` table, so a container
 * deployment only needs `SESSION_SECRET` to get going.
 */
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { getTimezone, hydrateRuntimeConfig, isValidTimezone, setLocale, setTimezone } from '../config/runtime';
import { childLogger } from '../utils/logger';
import { ValidationError } from '../utils/errors';
import { SettingsRepository } from '../repositories/settingsRepository';
import { audit, AuditEvent } from './auditService';

const log = childLogger('setup');

export const SetupKeys = {
  Completed: 'setup.completed',
  Username: 'auth.username',
  PasswordHash: 'auth.passwordHash',
  Timezone: 'app.timezone',
  Locale: 'app.locale',
} as const;

export interface AdminCredentials {
  username: string;
  password: string;
  confirmPassword: string;
}

export interface StoredCredentials {
  username: string;
  passwordHash: string;
}

export class SetupService {
  private readonly repo: SettingsRepository;
  /** True when credentials come from the environment — the wizard is then skipped. */
  private readonly envConfigured: boolean;

  constructor(
    repo: SettingsRepository = new SettingsRepository(),
    envConfigured: boolean = Boolean(config.auth.password || config.auth.passwordHash),
  ) {
    this.repo = repo;
    this.envConfigured = envConfigured;
  }

  /** Environment credentials always win, which keeps IaC deployments declarative. */
  public get isEnvConfigured(): boolean {
    return this.envConfigured;
  }

  async isComplete(): Promise<boolean> {
    if (this.envConfigured) return true;
    return this.repo.getBool(SetupKeys.Completed, false);
  }

  /** Credentials stored by the wizard, if any. */
  async storedCredentials(): Promise<StoredCredentials | null> {
    const [username, passwordHash] = await Promise.all([
      this.repo.get(SetupKeys.Username),
      this.repo.get(SetupKeys.PasswordHash),
    ]);
    return username && passwordHash ? { username, passwordHash } : null;
  }

  /** Applies persisted timezone/locale overrides. Called once at boot. */
  async hydrate(): Promise<void> {
    const values = await this.repo.asObject().catch(() => ({}) as Record<string, string>);
    hydrateRuntimeConfig(values);
  }

  /** Step 1 — create the administrator account. */
  async createAdmin(input: AdminCredentials): Promise<void> {
    const username = (input.username ?? '').trim();
    if (username.length < 3) throw new ValidationError('Username must be at least 3 characters.');
    if (!input.password || input.password.length < 10) {
      throw new ValidationError('Password must be at least 10 characters.');
    }
    if (input.password !== input.confirmPassword) {
      throw new ValidationError('The two passwords do not match.');
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    await this.repo.setMany({ [SetupKeys.Username]: username, [SetupKeys.PasswordHash]: passwordHash });
    log.info('Administrator account created via setup wizard', { username });
  }

  /** Step 2 — timezone, locale and the assistant's signature. */
  async saveLocalization(input: { timezone: string; locale?: string; signature?: string }): Promise<void> {
    if (!isValidTimezone(input.timezone)) {
      throw new ValidationError(`"${input.timezone}" is not a valid IANA timezone.`);
    }
    setTimezone(input.timezone);
    const patch: Record<string, string> = { [SetupKeys.Timezone]: input.timezone };

    if (input.locale) {
      if (!setLocale(input.locale)) throw new ValidationError(`"${input.locale}" is not a valid locale.`);
      patch[SetupKeys.Locale] = input.locale;
    }
    if (input.signature !== undefined) patch['branding.signature'] = input.signature;

    await this.repo.setMany(patch);
    log.info('Localization saved', { timezone: input.timezone, locale: input.locale });
  }

  /** Step 4 — marks the wizard finished so the guard stops redirecting. */
  async complete(detail: Record<string, unknown> = {}): Promise<void> {
    await this.repo.set(SetupKeys.Completed, 'true');
    await audit.info(AuditEvent.SetupCompleted, { timezone: getTimezone(), ...detail });
    log.info('Setup wizard completed', detail);
  }

  /** Escape hatch for re-running the wizard from Settings. */
  async reset(): Promise<void> {
    await this.repo.set(SetupKeys.Completed, 'false');
    log.warn('Setup wizard reset — the next dashboard visit will re-run it');
  }
}

export const setupService = new SetupService();
