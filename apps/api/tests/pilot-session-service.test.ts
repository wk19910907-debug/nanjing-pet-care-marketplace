import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ActorContext } from '../src/auth/auth-service.js';
import {
  createPilotCredential,
  digestPilotCredential,
} from '../src/auth/pilot-credential.js';
import { PilotSessionService } from '../src/auth/pilot-session-service.js';

const execFileAsync = promisify(execFile);
const databaseName = `petcare_pilot_session_${randomUUID().replaceAll('-', '')}`;
const databaseBaseUrl = process.env.DATABASE_URL
  ?? 'postgresql://petcare:petcare@127.0.0.1:54329/petcare';
const adminUrl = new URL(databaseBaseUrl);
adminUrl.pathname = '/postgres';
const testUrl = new URL(databaseBaseUrl);
testUrl.pathname = `/${databaseName}`;

const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
let prisma: PrismaClient;

const prismaCli = fileURLToPath(new URL('../../../node_modules/prisma/build/index.js', import.meta.url));
const schemaPath = fileURLToPath(new URL('../../../prisma/schema.prisma', import.meta.url));

function sequenceTokens(...tokens: string[]) {
  let index = 0;
  return () => {
    const token = tokens[index];
    if (token === undefined) throw new Error('TEST_TOKEN_SEQUENCE_EXHAUSTED');
    index += 1;
    return token;
  };
}

function localUserMarker(role: 'OWNER' | 'PROVIDER' | 'ADMIN'): string {
  return createHash('sha256').update(`pilot-local-direct-v1\0${role}`, 'utf8').digest('hex');
}

async function resetTables() {
  await prisma.pilotSession.deleteMany();
  await prisma.pilotInvite.deleteMany();
  await prisma.user.deleteMany();
}

describe('pilot credential hashing', () => {
  it('creates high-entropy URL-safe credentials with purpose-separated digests', () => {
    const pepper = Buffer.alloc(32, 7);
    const random = (size: number) => Buffer.alloc(size, 255);

    const invite = createPilotCredential(pepper, 'invite', random);
    const session = createPilotCredential(pepper, 'session', random);

    expect(invite.raw).toBe(Buffer.alloc(32, 255).toString('base64url'));
    expect(invite.digest).toBe(digestPilotCredential(pepper, 'invite', invite.raw));
    expect(session.digest).toBe(digestPilotCredential(pepper, 'session', session.raw));
    expect(invite.digest).not.toBe(session.digest);
    expect(invite.digest).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('PilotSessionService', () => {
  beforeAll(async () => {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    await execFileAsync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schemaPath], {
      env: { ...process.env, DATABASE_URL: testUrl.toString() },
    });
    prisma = new PrismaClient({ datasourceUrl: testUrl.toString() });
    await prisma.$connect();
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`,
    );
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.$disconnect();
  });

  it('issues sessions with only a digest persisted and revokes every active session for a user', async () => {
    await resetTables();
    const user = await prisma.user.create({ data: { role: 'ADMIN' } });
    const pepper = Buffer.alloc(32, 7);
    const service = new PilotSessionService(prisma, {
      pepper,
      inviteHours: 24,
      sessionDays: 7,
      now: () => new Date('2026-09-02T08:00:00Z'),
      token: sequenceTokens('staff-session-one', 'staff-session-two'),
    });

    const first = await service.createSessionForUser(user.id);
    const second = await service.createSessionForUser(user.id);
    const stored = await prisma.pilotSession.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });

    expect(first.expiresAt).toEqual(new Date('2026-09-09T08:00:00Z'));
    expect(stored.map((session) => session.tokenHash)).toEqual([
      digestPilotCredential(pepper, 'session', first.token),
      digestPilotCredential(pepper, 'session', second.token),
    ]);
    expect(JSON.stringify(stored)).not.toContain(first.token);
    expect(JSON.stringify(stored)).not.toContain(second.token);

    await expect(service.revokeAllForUser(user.id)).resolves.toBe(2);
    expect(await prisma.pilotSession.count({
      where: { userId: user.id, revokedAt: null },
    })).toBe(0);
  });

  it('bootstraps an admin invite, persists only digests, and redeems a targeted invite', async () => {
    await resetTables();
    const service = new PilotSessionService(prisma, {
      pepper: Buffer.alloc(32, 7),
      inviteHours: 24,
      sessionDays: 7,
      now: () => new Date('2026-08-25T08:00:00Z'),
      token: sequenceTokens('admin-invite', 'admin-session'),
    });

    const bootstrap = await service.bootstrapAdminInvite();
    expect(bootstrap.code).toBe('admin-invite');
    const savedInvite = await prisma.pilotInvite.findFirstOrThrow();
    expect(savedInvite.codeHash).toBe(
      digestPilotCredential(Buffer.alloc(32, 7), 'invite', 'admin-invite'),
    );
    expect(savedInvite).not.toHaveProperty('code', 'admin-invite');

    const adminLogin = await service.redeem('admin-invite');
    const actor = await service.authenticate(`Bearer ${adminLogin.token}`);
    expect(actor).toMatchObject({
      role: 'ADMIN', displayName: null, expiresAt: adminLogin.expiresAt,
    });
    expect(await prisma.user.count({ where: { role: 'ADMIN' } })).toBe(1);
    expect(await prisma.pilotSession.findFirstOrThrow()).not.toHaveProperty(
      'token',
      'admin-session',
    );
  });

  it('reuses the stable owner user across repeated local sessions', async () => {
    await resetTables();
    const service = new PilotSessionService(prisma, {
      pepper: Buffer.alloc(32, 7),
      inviteHours: 24,
      sessionDays: 7,
      now: () => new Date('2026-08-25T08:00:00Z'),
      token: sequenceTokens('owner-session-one', 'owner-session-two'),
    });

    const first = await service.createLocalSession('OWNER');
    const firstActor = await service.authenticate(`Bearer ${first.token}`);
    const second = await service.createLocalSession('OWNER');
    const secondActor = await service.authenticate(`Bearer ${second.token}`);

    expect(firstActor).toMatchObject({ role: 'OWNER' });
    expect(secondActor).toMatchObject({ userId: firstActor.userId, role: 'OWNER' });
    expect(await prisma.user.findMany({
      where: { phoneHash: localUserMarker('OWNER') },
      select: { id: true, role: true, phoneHash: true },
    })).toEqual([{
      id: firstActor.userId,
      role: 'OWNER',
      phoneHash: localUserMarker('OWNER'),
    }]);
  });

  it('creates a private app-scoped WeChat owner identity with a usable, revocable session', async () => {
    await resetTables();
    const service = new PilotSessionService(prisma, {
      pepper: Buffer.alloc(32, 7), inviteHours: 24, sessionDays: 7,
    });
    const identity = { appId: 'wx1234567890abcdef', openId: 'verified-wechat-openid' };
    const first = await service.createWechatSession(identity);
    const actor = await service.authenticate(`Bearer ${first.token}`);
    const second = await service.createWechatSession(identity);
    expect(await service.authenticate(`Bearer ${second.token}`))
      .toMatchObject({ userId: actor.userId, role: 'OWNER', displayName: null });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    expect(user.wechatOpenId).toMatch(/^wx1:[a-f0-9]{64}$/);
    expect(user.wechatOpenId).not.toContain(identity.openId);
    const other = await service.createWechatSession({ ...identity, appId: 'wxabcdef1234567890' });
    expect((await service.authenticate(`Bearer ${other.token}`)).userId).not.toBe(actor.userId);
    expect(await prisma.pilotInvite.count()).toBe(0);
    expect(await prisma.pilotSession.findFirstOrThrow()).not.toHaveProperty('token');
    await service.revoke(`Bearer ${first.token}`);
    await expect(service.authenticate(`Bearer ${first.token}`)).rejects.toThrow('UNAUTHENTICATED');
  });

  it('converges simultaneous WeChat signups and never resets an existing provider or elevates to staff', async () => {
    await resetTables();
    const options = { pepper: Buffer.alloc(32, 7), inviteHours: 24, sessionDays: 7 };
    const identity = { appId: 'wx1234567890abcdef', openId: 'concurrent-wechat-openid' };
    const services = [new PilotSessionService(prisma, options), new PilotSessionService(prisma, options)];
    const logins = await Promise.all(services.map((service) => service.createWechatSession(identity)));
    const actors = await Promise.all(logins.map((login) => services[0]!.authenticate(`Bearer ${login.token}`)));
    expect(new Set(actors.map((actor) => actor.userId))).toHaveLength(1);
    expect(await prisma.user.count()).toBe(1);
    await prisma.user.update({ where: { id: actors[0]!.userId }, data: { role: 'PROVIDER' } });
    const provider = await services[0]!.createWechatSession(identity);
    expect((await services[0]!.authenticate(`Bearer ${provider.token}`)).role).toBe('PROVIDER');
    await prisma.user.update({ where: { id: actors[0]!.userId }, data: { role: 'ADMIN' } });
    await expect(services[0]!.createWechatSession(identity)).rejects.toThrow('FORBIDDEN');
    expect(await prisma.pilotSession.count()).toBe(3);
  });

  it('creates distinct stable users for every allowed local role', async () => {
    await resetTables();
    const roles = ['OWNER', 'PROVIDER', 'ADMIN'] as const;
    const service = new PilotSessionService(prisma, {
      pepper: Buffer.alloc(32, 7),
      inviteHours: 24,
      sessionDays: 7,
      now: () => new Date('2026-08-25T08:00:00Z'),
      token: sequenceTokens('owner-session', 'provider-session', 'admin-session'),
    });

    const actors = await Promise.all(roles.map(async (role) => {
      const session = await service.createLocalSession(role as 'OWNER' | 'PROVIDER' | 'ADMIN');
      return service.authenticate(`Bearer ${session.token}`);
    }));

    expect(actors.map((actor) => actor.role).sort()).toEqual(['ADMIN', 'OWNER', 'PROVIDER']);
    expect(new Set(actors.map((actor) => actor.userId))).toHaveLength(3);
    expect(await prisma.user.findMany({
      where: { phoneHash: { in: roles.map(localUserMarker) } },
      orderBy: { role: 'asc' },
      select: { role: true, phoneHash: true },
    })).toEqual([
      { role: 'OWNER', phoneHash: localUserMarker('OWNER') },
      { role: 'PROVIDER', phoneHash: localUserMarker('PROVIDER') },
      { role: 'ADMIN', phoneHash: localUserMarker('ADMIN') },
    ]);
  });

  it('converges concurrent service instances on one local owner user', async () => {
    await resetTables();
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION test_delay_local_user_insert() RETURNS trigger AS $$
      BEGIN
        IF NEW."phoneHash" = '${localUserMarker('OWNER')}' THEN
          PERFORM pg_sleep(0.25);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_delay_local_user_insert
      BEFORE INSERT ON "User"
      FOR EACH ROW EXECUTE FUNCTION test_delay_local_user_insert()
    `);
    const clients = [
      new PrismaClient({ datasourceUrl: testUrl.toString() }),
      new PrismaClient({ datasourceUrl: testUrl.toString() }),
    ];

    try {
      await Promise.all(clients.map((client) => client.$connect()));
      const sessions = await Promise.all(clients.map(async (client) => {
        const service = new PilotSessionService(client, {
          pepper: Buffer.alloc(32, 7),
          inviteHours: 24,
          sessionDays: 7,
          now: () => new Date('2026-08-25T08:00:00Z'),
          token: () => randomUUID(),
        });
        return service.createLocalSession('OWNER');
      }));

      const actors = await Promise.all(sessions.map((session) =>
        new PilotSessionService(prisma, {
          pepper: Buffer.alloc(32, 7),
          inviteHours: 24,
          sessionDays: 7,
          now: () => new Date('2026-08-25T08:00:00Z'),
        }).authenticate(`Bearer ${session.token}`),
      ));
      expect(new Set(actors.map((actor) => actor.userId))).toHaveLength(1);
      expect(await prisma.user.count({ where: { phoneHash: localUserMarker('OWNER') } })).toBe(1);
    } finally {
      await Promise.all(clients.map((client) => client.$disconnect()));
      await prisma.$executeRawUnsafe('DROP TRIGGER test_delay_local_user_insert ON "User"');
      await prisma.$executeRawUnsafe('DROP FUNCTION test_delay_local_user_insert()');
    }
  });

  it('preserves a sole admin across concurrent bootstrap processes', async () => {
    await resetTables();
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION test_delay_admin_insert() RETURNS trigger AS $$
      BEGIN
        IF NEW.role = 'ADMIN' THEN
          PERFORM pg_sleep(0.25);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_delay_admin_insert
      BEFORE INSERT ON "User"
      FOR EACH ROW EXECUTE FUNCTION test_delay_admin_insert()
    `);
    const clients = [
      new PrismaClient({ datasourceUrl: testUrl.toString() }),
      new PrismaClient({ datasourceUrl: testUrl.toString() }),
    ];

    try {
      await Promise.all(clients.map((client) => client.$connect()));
      const services = clients.map((client, index) => new PilotSessionService(client, {
        pepper: Buffer.alloc(32, 7),
        inviteHours: 24,
        sessionDays: 7,
        now: () => new Date('2026-08-25T08:00:00Z'),
        token: sequenceTokens(`admin-invite-${index}`),
      }));

      const results = await Promise.allSettled(
        services.map((service) => service.bootstrapAdminInvite()),
      );
      expect(results.some((result) => result.status === 'fulfilled')).toBe(true);

      const admins = await prisma.user.findMany({
        where: { role: 'ADMIN' },
        select: { id: true },
      });
      const invites = await prisma.pilotInvite.findMany({
        where: { role: 'ADMIN' },
        select: { targetUserId: true },
      });
      expect(admins).toHaveLength(1);
      expect(new Set(invites.map((invite) => invite.targetUserId))).toEqual(
        new Set([admins[0]?.id]),
      );
    } finally {
      await Promise.all(clients.map((client) => client.$disconnect()));
      await prisma.$executeRawUnsafe('DROP TRIGGER test_delay_admin_insert ON "User"');
      await prisma.$executeRawUnsafe('DROP FUNCTION test_delay_admin_insert()');
    }
  });

  it('allows only one concurrent redemption of an owner invite', async () => {
    await resetTables();
    const service = new PilotSessionService(prisma, {
      pepper: Buffer.alloc(32, 7),
      inviteHours: 24,
      sessionDays: 7,
      now: () => new Date('2026-08-25T08:00:00Z'),
      token: sequenceTokens(
        'admin-invite',
        'admin-session',
        'owner-invite',
        'owner-session-one',
        'owner-session-two',
      ),
    });

    const bootstrap = await service.bootstrapAdminInvite();
    const adminLogin = await service.redeem(bootstrap.code);
    const adminActor = await service.authenticate(`Bearer ${adminLogin.token}`);
    const ownerInvite = await service.createInvite(adminActor, 'OWNER');

    const [first, second] = await Promise.allSettled([
      service.redeem(ownerInvite.code),
      service.redeem(ownerInvite.code),
    ]);

    expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = [first, second].find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected?.reason).toMatchObject({ message: 'INVITE_INVALID' });
    expect(await prisma.pilotSession.count({ where: { user: { role: 'OWNER' } } })).toBe(1);
    expect(await prisma.user.count({ where: { role: 'OWNER' } })).toBe(1);
  });

  it('uses INVITE_INVALID for unknown, expired, and consumed invitation codes', async () => {
    await resetTables();
    let now = new Date('2026-08-25T08:00:00Z');
    const service = new PilotSessionService(prisma, {
      pepper: Buffer.alloc(32, 7),
      inviteHours: 1,
      sessionDays: 7,
      now: () => now,
      token: sequenceTokens('admin-invite', 'admin-session'),
    });
    const bootstrap = await service.bootstrapAdminInvite();

    await expect(service.redeem('unknown')).rejects.toThrow('INVITE_INVALID');
    now = new Date('2026-08-25T09:00:00Z');
    await expect(service.redeem(bootstrap.code)).rejects.toThrow('INVITE_INVALID');
    now = new Date('2026-08-25T08:30:00Z');
    await service.redeem(bootstrap.code);
    await expect(service.redeem(bootstrap.code)).rejects.toThrow('INVITE_INVALID');
  });

  it('rejects expired, revoked, and malformed sessions as UNAUTHENTICATED', async () => {
    await resetTables();
    let now = new Date('2026-08-25T08:00:00Z');
    const service = new PilotSessionService(prisma, {
      pepper: Buffer.alloc(32, 7),
      inviteHours: 24,
      sessionDays: 1,
      now: () => now,
      token: sequenceTokens('admin-invite', 'admin-session'),
    });
    const bootstrap = await service.bootstrapAdminInvite();
    const login = await service.redeem(bootstrap.code);
    const authorization = `Bearer ${login.token}`;

    await expect(service.authenticate(undefined)).rejects.toThrow('UNAUTHENTICATED');
    await expect(service.authenticate('Basic admin-session')).rejects.toThrow('UNAUTHENTICATED');
    await service.revoke(authorization);
    await expect(service.authenticate(authorization)).rejects.toThrow('UNAUTHENTICATED');

    await prisma.pilotSession.updateMany({ data: { revokedAt: null } });
    now = new Date('2026-08-26T08:00:00Z');
    await expect(service.authenticate(authorization)).rejects.toThrow('UNAUTHENTICATED');
  });

  it('allows only admins to create supported invitation roles and lists no credential hashes', async () => {
    await resetTables();
    const service = new PilotSessionService(prisma, {
      pepper: Buffer.alloc(32, 7),
      inviteHours: 24,
      sessionDays: 7,
      now: () => new Date('2026-08-25T08:00:00Z'),
      token: sequenceTokens('owner-invite'),
    });
    const adminUser = await prisma.user.create({ data: { role: 'ADMIN' } });
    const ownerUser = await prisma.user.create({ data: { role: 'OWNER' } });
    const adminActor: ActorContext = { userId: adminUser.id, role: 'ADMIN' };
    const ownerActor: ActorContext = { userId: ownerUser.id, role: 'OWNER' };

    await expect(service.createInvite(ownerActor, 'OWNER')).rejects.toThrow('FORBIDDEN');
    await expect(
      service.createInvite(adminActor, 'REVIEWER' as 'OWNER'),
    ).rejects.toThrow('INVITE_ROLE_INVALID');

    await service.createInvite(adminActor, 'OWNER');
    const invites = await service.listInvites(adminActor);
    expect(invites).toHaveLength(1);
    expect(invites[0]).toMatchObject({ role: 'OWNER', consumedAt: null });
    expect(invites[0]).not.toHaveProperty('codeHash');
    expect(invites[0]).not.toHaveProperty('code');
    await expect(service.listInvites(ownerActor)).rejects.toThrow('FORBIDDEN');
  });

  it.each([
    '13800138000',
    'wx_abcdef',
    'user@example.com',
    '编号123456',
    '   ',
  ])('rejects unsafe display name %j', async (value) => {
    await resetTables();
    const user = await prisma.user.create({ data: { role: 'OWNER' } });
    const service = new PilotSessionService(prisma, {
      pepper: Buffer.alloc(32, 7),
      inviteHours: 24,
      sessionDays: 7,
      now: () => new Date('2026-08-25T08:00:00Z'),
      token: sequenceTokens(),
    });

    await expect(
      service.setDisplayName({ userId: user.id, role: 'OWNER' }, value),
    ).rejects.toThrow('DISPLAY_NAME_INVALID');
  });

  it('trims and stores a safe display name on the current user only', async () => {
    await resetTables();
    const first = await prisma.user.create({ data: { role: 'OWNER' } });
    const second = await prisma.user.create({ data: { role: 'OWNER' } });
    const service = new PilotSessionService(prisma, {
      pepper: Buffer.alloc(32, 7),
      inviteHours: 24,
      sessionDays: 7,
      now: () => new Date('2026-08-25T08:00:00Z'),
      token: sequenceTokens(),
    });

    const updated = await service.setDisplayName(
      { userId: first.id, role: 'OWNER' },
      '  秦淮小林  ',
    );

    expect(updated).toMatchObject({ id: first.id, displayName: '秦淮小林' });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({
      displayName: null,
    });
  });
});
