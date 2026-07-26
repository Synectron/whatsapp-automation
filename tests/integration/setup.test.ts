import request from 'supertest';
import type { Knex } from 'knex';
import type { Express } from 'express';
import { createTestDb, destroyTestDb, seedTestDb } from '../helpers/testDb';
import { FakeGateway } from '../helpers/fakeGateway';
import { createApp } from '../../src/app';
import { buildContainer, type Container } from '../../src/container';
import { SetupService } from '../../src/services/setupService';
import { SettingsRepository } from '../../src/repositories/settingsRepository';
import { getTimezone, resetRuntimeConfig } from '../../src/config/runtime';
import { ValidationError } from '../../src/utils/errors';

/** Reads the CSRF token out of a rendered form. */
const tokenOf = (html: string): string => /name="_csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';

describe('first-boot setup wizard', () => {
  let knex: Knex;
  let app: Express;
  let container: Container;
  let setup: SetupService;
  let gateway: FakeGateway;

  beforeEach(async () => {
    knex = await createTestDb();
    await seedTestDb(knex);
    resetRuntimeConfig();
    gateway = new FakeGateway();
    // `false` = pretend no dashboard password was supplied through the environment.
    setup = new SetupService(new SettingsRepository(), false);
    container = buildContainer({ gateway, setup });
    app = createApp(container, { ephemeralSessions: true });
  });

  afterEach(async () => {
    container.queue.stop();
    container.scheduler.stop();
    resetRuntimeConfig();
    await destroyTestDb(knex);
  });

  describe('SetupService', () => {
    it('is incomplete on a fresh database', async () => {
      await expect(setup.isComplete()).resolves.toBe(false);
    });

    it('is complete when the environment supplies credentials', async () => {
      await expect(new SetupService(new SettingsRepository(), true).isComplete()).resolves.toBe(true);
    });

    it('stores a bcrypt hash, never the plaintext password', async () => {
      await setup.createAdmin({ username: 'shubham', password: 'correct-horse-battery', confirmPassword: 'correct-horse-battery' });
      const stored = await setup.storedCredentials();
      expect(stored?.username).toBe('shubham');
      expect(stored?.passwordHash).toMatch(/^\$2[aby]\$/);
      expect(stored?.passwordHash).not.toContain('correct-horse-battery');
    });

    it.each([
      [{ username: 'ab', password: 'long-enough-password', confirmPassword: 'long-enough-password' }, /at least 3/i],
      [{ username: 'admin', password: 'short', confirmPassword: 'short' }, /at least 10/i],
      [{ username: 'admin', password: 'long-enough-password', confirmPassword: 'different-password' }, /do not match/i],
    ])('rejects invalid credentials (%#)', async (input, expected) => {
      await expect(setup.createAdmin(input)).rejects.toThrow(expected);
    });

    it('applies the timezone immediately and persists it', async () => {
      await setup.saveLocalization({ timezone: 'Europe/Lisbon', locale: 'en-GB' });
      expect(getTimezone()).toBe('Europe/Lisbon');
      await expect(new SettingsRepository().get('app.timezone')).resolves.toBe('Europe/Lisbon');
    });

    it('rejects an unknown timezone', async () => {
      await expect(setup.saveLocalization({ timezone: 'Mars/Olympus' })).rejects.toBeInstanceOf(ValidationError);
    });

    it('restores a persisted timezone on boot', async () => {
      await new SettingsRepository().set('app.timezone', 'America/New_York');
      await setup.hydrate();
      expect(getTimezone()).toBe('America/New_York');
    });
  });

  describe('routing', () => {
    it('redirects the dashboard to the wizard until setup is done', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/setup');
    });

    it('keeps the health probe reachable during setup', async () => {
      await expect(request(app).get('/healthz')).resolves.toMatchObject({ status: 200 });
    });

    it('renders step 1 without authentication', async () => {
      const res = await request(app).get('/setup');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Create the administrator account');
    });

    it('exposes connection state for the QR poll', async () => {
      const res = await request(app).get('/setup/status');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ connected: true });
    });

    it('locks the wizard once setup is complete', async () => {
      await setup.complete();
      const res = await request(app).get('/setup');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login');
    });
  });

  describe('walking the wizard', () => {
    it('completes end to end and enables the chosen group', async () => {
      gateway.groups = [
        { whatsappId: '111@g.us', name: 'Project Falcon', participantCount: 8 },
        { whatsappId: '222@g.us', name: 'Family', participantCount: 4 },
      ];

      const agent = request.agent(app);

      // Step 1 — account
      const step1 = await agent.get('/setup');
      await agent
        .post('/setup/account')
        .type('form')
        .send({ username: 'shubham', password: 'a-good-long-password', confirmPassword: 'a-good-long-password', _csrf: tokenOf(step1.text) })
        .expect(302);

      // Step 2 — localization
      const step2 = await agent.get('/setup?step=2');
      await agent
        .post('/setup/localization')
        .type('form')
        .send({ timezone: 'Europe/London', locale: 'en-GB', signature: '— Team bot', _csrf: tokenOf(step2.text) })
        .expect(302);
      expect(getTimezone()).toBe('Europe/London');

      // Step 3 — link WhatsApp, then discover groups
      const step3 = await agent.get('/setup?step=3');
      await agent.post('/setup/connect/sync').type('form').send({ _csrf: tokenOf(step3.text) }).expect(302);
      const groups = await container.groups.list();
      expect(groups).toHaveLength(2);
      expect(groups.every((g) => !g.enabled)).toBe(true);

      // Step 4 — enable one group with a starter reminder
      const step4 = await agent.get('/setup?step=4');
      expect(step4.text).toContain('Project Falcon');
      await agent
        .post('/setup/groups')
        .type('form')
        .send({ groupIds: String(groups[0].id), starters: 'daily', _csrf: tokenOf(step4.text) })
        .expect(302);

      await expect(setup.isComplete()).resolves.toBe(true);
      const after = await container.groups.list();
      expect(after.find((g) => g.id === groups[0].id)?.enabled).toBe(true);
      expect(after.find((g) => g.id === groups[1].id)?.enabled).toBe(false);

      const schedules = await container.schedules.list();
      expect(schedules).toHaveLength(1);
      expect(schedules[0]).toMatchObject({ name: 'Daily check-in', cron: '30 9 * * 1-5', enabled: true });
    });

    it('re-renders step 1 with an error instead of crashing on bad input', async () => {
      const agent = request.agent(app);
      const page = await agent.get('/setup');
      const res = await agent
        .post('/setup/account')
        .type('form')
        .send({ username: 'admin', password: 'short', confirmPassword: 'short', _csrf: tokenOf(page.text) });

      expect(res.status).toBe(200);
      expect(res.text).toContain('at least 10 characters');
      await expect(setup.storedCredentials()).resolves.toBeNull();
    });

    it('rejects wizard posts without a CSRF token', async () => {
      const res = await request(app).post('/setup/account').type('form').send({ username: 'x', password: 'y' });
      expect(res.status).toBe(403);
    });

    it('finishes with no groups selected', async () => {
      const agent = request.agent(app);
      const page = await agent.get('/setup?step=4');
      await agent.post('/setup/groups').type('form').send({ _csrf: tokenOf(page.text) }).expect(302);
      await expect(setup.isComplete()).resolves.toBe(true);
    });
  });

  describe('credentials created by the wizard', () => {
    it('are accepted at the login form', async () => {
      await setup.createAdmin({ username: 'shubham', password: 'a-good-long-password', confirmPassword: 'a-good-long-password' });
      await setup.complete();

      const page = await request(app).get('/login');
      const cookie = page.headers['set-cookie'] as unknown as string[];
      const res = await request(app)
        .post('/login')
        .set('Cookie', cookie)
        .type('form')
        .send({ username: 'shubham', password: 'a-good-long-password', _csrf: tokenOf(page.text) });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/');
    });

    it('take precedence over the environment password', async () => {
      await setup.createAdmin({ username: 'shubham', password: 'a-good-long-password', confirmPassword: 'a-good-long-password' });
      await setup.complete();

      const page = await request(app).get('/login');
      const cookie = page.headers['set-cookie'] as unknown as string[];
      const res = await request(app)
        .post('/login')
        .set('Cookie', cookie)
        .type('form')
        .send({ username: 'admin', password: 'test-password', _csrf: tokenOf(page.text) });

      expect(res.status).toBe(401);
    });
  });
});
