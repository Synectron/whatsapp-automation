/** Schedule CRUD with cron validation and scheduler synchronisation hooks. */
import { assertValidCron, describeCron } from '../utils/cron';
import { NotFoundError, ValidationError } from '../utils/errors';
import { ScheduleRepository, type ScheduleInput } from '../repositories/scheduleRepository';
import { GroupRepository } from '../repositories/groupRepository';
import { TemplateRepository } from '../repositories/templateRepository';
import { audit, AuditEvent } from './auditService';
import type { ScheduleRecord } from '../models/types';

/** Return values are ignored; async listeners are awaited. */
export type ScheduleChangeListener = () => unknown;

export class ScheduleService {
  private readonly listeners = new Set<ScheduleChangeListener>();

  constructor(
    private readonly repo: ScheduleRepository = new ScheduleRepository(),
    private readonly groups: GroupRepository = new GroupRepository(),
    private readonly templates: TemplateRepository = new TemplateRepository(),
  ) {}

  /** The scheduler subscribes here so cron jobs reload after any change. */
  onChange(listener: ScheduleChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async notify(): Promise<void> {
    for (const listener of this.listeners) await listener();
  }

  list(filter: { groupId?: number; enabledOnly?: boolean } = {}) {
    return this.repo.list(filter);
  }

  listActive() {
    return this.repo.listActive();
  }

  async get(id: number): Promise<ScheduleRecord> {
    const schedule = await this.repo.findById(id);
    if (!schedule) throw new NotFoundError('Schedule');
    return schedule;
  }

  private async validate(input: Partial<ScheduleInput>): Promise<void> {
    if (input.groupId !== undefined) {
      const group = await this.groups.findById(input.groupId);
      if (!group) throw new ValidationError(`Group ${input.groupId} does not exist.`);
    }
    if (input.templateId !== undefined && input.templateId !== null) {
      const template = await this.templates.findById(input.templateId);
      if (!template) throw new ValidationError(`Template ${input.templateId} does not exist.`);
    }
    if (input.message !== undefined && !input.message.trim()) {
      throw new ValidationError('Schedule message cannot be empty.');
    }
  }

  async create(input: ScheduleInput): Promise<ScheduleRecord> {
    await this.validate(input);
    let cron: string;
    try {
      cron = assertValidCron(input.cron);
    } catch (err) {
      throw new ValidationError((err as Error).message, { field: 'cron' });
    }
    const schedule = await this.repo.create({ ...input, cron });
    await audit.info(AuditEvent.ScheduleCreated, {
      id: schedule.id,
      name: schedule.name,
      cron: schedule.cron,
      describes: describeCron(schedule.cron),
    }, schedule.groupId);
    await this.notify();
    return schedule;
  }

  async update(id: number, patch: Partial<ScheduleInput>): Promise<ScheduleRecord> {
    await this.get(id);
    await this.validate(patch);
    if (patch.cron !== undefined) {
      try {
        patch.cron = assertValidCron(patch.cron);
      } catch (err) {
        throw new ValidationError((err as Error).message, { field: 'cron' });
      }
    }
    const updated = await this.repo.update(id, patch);
    if (!updated) throw new NotFoundError('Schedule');
    await audit.info(AuditEvent.ScheduleUpdated, { id, patch: Object.keys(patch) }, updated.groupId);
    await this.notify();
    return updated;
  }

  async remove(id: number): Promise<void> {
    const schedule = await this.get(id);
    await this.repo.remove(id);
    await audit.info(AuditEvent.ScheduleDeleted, { id, name: schedule.name }, schedule.groupId);
    await this.notify();
  }

  async toggle(id: number, enabled: boolean): Promise<ScheduleRecord> {
    return this.update(id, { enabled });
  }

  claimRun = this.repo.claimRun.bind(this.repo);
  completeRun = this.repo.completeRun.bind(this.repo);
  markRun = this.repo.markRun.bind(this.repo);
  pruneRuns = this.repo.pruneRuns.bind(this.repo);
  describe = describeCron;
}

export const scheduleService = new ScheduleService();
