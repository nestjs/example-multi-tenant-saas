import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import { getDrizzleToken } from '@nestjs/drizzle';
import { InMemoryMailTransport, MailTransport } from '@nestjs/mail';
import { NodeAdapter, type NestNodeApplication } from '@nestjs/platform-node';
import { Test } from '@nestjs/testing';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module.js';
import { auditEvents, memberships } from '../src/database/schema.js';

// A real PostgreSQL with a pool, so concurrent requests really race.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('SaaS API (e2e)', () => {
  const db = drizzle({ client: new Pool({ connectionString: url, max: 20 }) });
  const mailbox = new InMemoryMailTransport();
  let app: NestNodeApplication;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.execute(sql`TRUNCATE users, organizations, refresh_tokens CASCADE`);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDrizzleToken())
      .useValue(db)
      // scrypt at the default cost takes 128 MiB and a few hundred ms per hash.
      .overrideProvider(PasswordHasher)
      .useValue(new PasswordHasher({ logN: 10 }))
      // Keeps the mails, so the test can follow the invitation link.
      .overrideProvider(MailTransport)
      .useValue(mailbox)
      .compile();
    app = moduleRef.createNestApplication<NestNodeApplication>(new NodeAdapter());
    await app.init();
  });

  afterAll(() => app.close()); // closes the pool too

  let clients = 0;

  /** Signs a user up, and returns their id and a function that sends requests as them. */
  async function signUp(name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-up',
      payload: { email: `${name}@example.com`, password: 'correct horse battery' },
      // Sign-up is rate-limited per IP address: each user gets one of their own.
      remoteAddress: `10.0.0.${++clients}`,
    });
    const headers = { authorization: `Bearer ${res.json<{ accessToken: string }>().accessToken}` };
    const me = await app.inject({ method: 'GET', url: '/me', headers });
    const send = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
      app.inject({ method, url, headers, payload });
    return { id: me.json<{ id: string }>().id, send };
  }

  async function createOrganization(owner: Awaited<ReturnType<typeof signUp>>, name: string) {
    const res = await owner.send('POST', '/orgs', { name });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string }>().id;
  }

  it("keeps each organization's data to its members", async () => {
    const ada = await signUp('ada');
    const bob = await signUp('bob');
    const acme = await createOrganization(ada, 'Acme');
    const globex = await createOrganization(bob, 'Globex');
    const project = (await ada.send('POST', `/orgs/${acme}/projects`, { name: 'Roadmap' })).json<{ id: string }>();

    // Through Acme's routes: Bob isn't a member, so Acme doesn't exist for him.
    for (const path of ['/members', '/projects', `/projects/${project.id}`, '/audit-events']) {
      expect((await bob.send('GET', `/orgs/${acme}${path}`)).statusCode).toBe(404);
    }
    // Through his own organization's routes: the WHERE clause doesn't find Acme's project.
    expect((await bob.send('GET', `/orgs/${globex}/projects/${project.id}`)).statusCode).toBe(404);
    expect((await bob.send('DELETE', `/orgs/${globex}/projects/${project.id}`)).statusCode).toBe(404);
    expect((await bob.send('GET', '/orgs/not-a-uuid/projects')).statusCode).toBe(404);

    expect((await ada.send('GET', `/orgs/${acme}/projects/${project.id}`)).json()).toMatchObject({ name: 'Roadmap' });
  });

  /** The organizations a ProjectsService was created for, while `run` ran. */
  async function projectsServicesCreated(run: () => Promise<unknown>) {
    const log = vi.spyOn(Logger.prototype, 'log');
    try {
      await run();
      return log.mock.calls.map(([message]) => String(message)).filter((m) => m.startsWith('Created for organization'));
    } finally {
      log.mockRestore();
    }
  }

  it('builds one ProjectsService per organization, and reuses it', async () => {
    const ada = await signUp('ada-durable');
    const initech = await createOrganization(ada, 'Initech');

    const created = await projectsServicesCreated(() =>
      Promise.all(Array.from({ length: 5 }, () => ada.send('GET', `/orgs/${initech}/projects`))),
    );

    expect(created).toEqual([`Created for organization ${initech}`]);
  });

  it("never serves one organization's requests from another's instance", async () => {
    const ada = await signUp('ada-two-orgs');
    const [hooli, piedPiper] = await Promise.all([
      createOrganization(ada, 'Hooli'),
      createOrganization(ada, 'Pied Piper'),
    ]);

    // Interleaved, at the same time: five projects in each organization.
    const created = await projectsServicesCreated(() =>
      Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          ada.send('POST', `/orgs/${i % 2 ? piedPiper : hooli}/projects`, { name: `Project ${i}` }),
        ),
      ),
    );

    expect(created.sort()).toEqual([hooli, piedPiper].sort().map((id) => `Created for organization ${id}`));
    for (const orgId of [hooli, piedPiper]) {
      const list = (await ada.send('GET', `/orgs/${orgId}/projects`)).json<{ orgId: string }[]>();
      expect(list).toHaveLength(5);
      expect(list.every((project) => project.orgId === orgId)).toBe(true);
    }
  });

  it('invites by email, with a link that works once, for its recipient only', async () => {
    const ada = await signUp('ada-inviter');
    const carol = await signUp('carol');
    const dave = await signUp('dave');
    const acme = await createOrganization(ada, 'Acme');

    expect((await ada.send('POST', `/orgs/${acme}/invitations`, { email: 'carol@example.com' })).statusCode).toBe(201);
    const mail = mailbox.assertSent({ to: 'carol@example.com', subject: 'Join Acme' });
    const token = mail.link('/invitations/accept').searchParams.get('token');

    // Someone the link was forwarded to can't use it.
    expect((await dave.send('POST', '/invitations/accept', { token })).statusCode).toBe(404);
    // Accepted twice at once: one request spends the token.
    const results = await Promise.all([1, 2].map(() => carol.send('POST', '/invitations/accept', { token })));
    expect(results.map((res) => res.statusCode).sort()).toEqual([200, 404]);

    expect((await carol.send('GET', `/orgs/${acme}/projects`)).statusCode).toBe(200);
    // A member doesn't invite, delete projects or change roles.
    expect((await carol.send('POST', `/orgs/${acme}/invitations`, { email: 'eve@example.com' })).statusCode).toBe(403);
    expect((await carol.send('PATCH', `/orgs/${acme}/members/${carol.id}`, { role: 'admin' })).statusCode).toBe(403);
  });

  it('never leaves an organization without an owner', async () => {
    const ada = await signUp('ada-owner');
    const bob = await signUp('bob-owner');
    // Ten organizations, each with two owners who step down at the same moment.
    const orgs = await Promise.all(Array.from({ length: 10 }, (_, i) => createOrganization(ada, `Org ${i}`)));
    await db.insert(memberships).values(orgs.map((orgId) => ({ orgId, userId: bob.id, role: 'owner' as const })));

    const results = await Promise.all(
      orgs.flatMap((orgId) => [
        ada.send('PATCH', `/orgs/${orgId}/members/${ada.id}`, { role: 'admin' }),
        bob.send('PATCH', `/orgs/${orgId}/members/${bob.id}`, { role: 'admin' }),
      ]),
    );

    for (const [i, orgId] of orgs.entries()) {
      expect([results[2 * i].statusCode, results[2 * i + 1].statusCode].sort()).toEqual([200, 409]);
      const owners = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.orgId, orgId), eq(memberships.role, 'owner')));
      expect(owners).toHaveLength(1);
      // The refused demotion wrote nothing to the audit log.
      const changes = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.orgId, orgId), eq(auditEvents.action, 'member.role_changed')));
      expect(changes).toHaveLength(1);
    }
  });
  it('lets only current owners change owners', async () => {
    const ada = await signUp('ada-third');
    const bob = await signUp('bob-third');
    const carol = await signUp('carol-third');
    // Ten organizations with three owners each. Ada removes Bob while Bob demotes Ada.
    const orgs = await Promise.all(Array.from({ length: 10 }, (_, i) => createOrganization(ada, `Trio ${i}`)));
    await db
      .insert(memberships)
      .values(orgs.flatMap((orgId) => [bob.id, carol.id].map((userId) => ({ orgId, userId, role: 'owner' as const }))));

    const results = await Promise.all(
      orgs.flatMap((orgId) => [
        ada.send('DELETE', `/orgs/${orgId}/members/${bob.id}`),
        bob.send('PATCH', `/orgs/${orgId}/members/${ada.id}`, { role: 'member' }),
      ]),
    );

    // Whichever ran second was no longer allowed to: Bob had been removed, or Ada demoted.
    for (const [i] of orgs.entries()) {
      const statuses = [results[2 * i].statusCode, results[2 * i + 1].statusCode];
      expect(statuses.filter((status) => status < 300)).toHaveLength(1);
    }
  });
});
