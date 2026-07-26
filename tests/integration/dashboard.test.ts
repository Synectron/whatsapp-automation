import request from 'supertest';
import type { Knex } from 'knex';
import type { Express } from 'express';
import { createTestDb, destroyTestDb, insertGroup, seedTestDb } from '../helpers/testDb';
import { FakeGateway } from '../helpers/fakeGateway';
import { createApp } from '../../src/app';
import { buildContainer, type Container } from '../../src/container';

describe('dashboard', () => {
  let knex: Knex;
  let app: Express;
  let container: Container;

  beforeEach(async () => {
    knex = await createTestDb();
    await seedTestDb(knex);
    await insertGroup(knex, { enabled: true });
    container = buildContainer({ gateway: new FakeGateway() });
    app = createApp(container, { ephemeralSessions: true });
  });

  afterEach(async () => {
    container.queue.stop();
    container.scheduler.stop();
    await destroyTestDb(knex);
  });

  /** Logs in and returns the session cookie plus a valid CSRF token. */
  async function login(): Promise<{ cookie: string[]; csrf: string }> {
    const agent = request.agent(app);
    const page = await agent.get('/login');
    const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1] ?? '';
    const cookie = page.headers['set-cookie'] as unknown as string[];

    const res = await request(app)
      .post('/login')
      .set('Cookie', cookie)
      .type('form')
      .send({ username: 'admin', password: 'test-password', _csrf: csrf });

    const sessionCookie = (res.headers['set-cookie'] as unknown as string[]) ?? cookie;
    const dash = await request(app).get('/').set('Cookie', sessionCookie);
    const freshCsrf = /name="_csrf" value="([^"]+)"/.exec(dash.text)?.[1] ?? csrf;
    return { cookie: sessionCookie, csrf: freshCsrf };
  }

  it('redirects anonymous visitors to the login page', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login');
  });

  it('renders the login page', async () => {
    const res = await request(app).get('/login');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Sign in');
  });

  it('rejects bad credentials', async () => {
    const page = await request(app).get('/login');
    const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1] ?? '';
    const res = await request(app)
      .post('/login')
      .set('Cookie', page.headers['set-cookie'] as unknown as string[])
      .type('form')
      .send({ username: 'admin', password: 'wrong', _csrf: csrf });

    expect(res.status).toBe(401);
    expect(res.text).toContain('Invalid username or password');
  });

  it('renders the overview after login', async () => {
    const { cookie } = await login();
    const res = await request(app).get('/').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Connection');
    expect(res.text).toContain('Test Group');
  });

  it.each(['/groups', '/schedules', '/send', '/templates', '/analytics', '/logs', '/settings'])(
    'renders %s',
    async (path) => {
      const { cookie } = await login();
      const res = await request(app).get(path).set('Cookie', cookie);
      expect(res.status).toBe(200);
    },
  );

  it('blocks form posts without a CSRF token', async () => {
    const { cookie } = await login();
    const res = await request(app).post('/groups/sync').set('Cookie', cookie).type('form').send({});
    expect(res.status).toBe(403);
  });

  it('accepts form posts with a valid CSRF token', async () => {
    const { cookie, csrf } = await login();
    const res = await request(app)
      .post('/send')
      .set('Cookie', cookie)
      .type('form')
      .send({ groupId: '1', message: 'Manual hello', _csrf: csrf });

    expect(res.status).toBe(302);
    await container.queue.drain();
  });
});
