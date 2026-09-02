import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaAuditRepository } from '../src/audit/audit-repository.js';
import type { ActorContext } from '../src/auth/auth-service.js';
import { PilotSessionService } from '../src/auth/pilot-session-service.js';
import {
  normalizeStaffUsername,
  StaffCredentialService,
  StaffLoginLimiter,
} from '../src/auth/staff-credential-service.js';

const execFileAsync = promisify(execFile);
const databaseBaseUrl = process.env.DATABASE_URL
  ?? 'postgresql://petcare:petcare@127.0.0.1:54329/petcare';
const adminUrl = new URL(databaseBaseUrl);
adminUrl.pathname = '/postgres';
const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
let prisma: PrismaClient;
let databaseName: string;
const prismaCli = fileURLToPath(new URL('../../../node_modules/prisma/build/index.js', import.meta.url));
const schemaPath = fileURLToPath(new URL('../../../prisma/schema.prisma', import.meta.url));
const pepper = Buffer.alloc(32, 23);

function createService(now: () => Date, overrides: Record<string, unknown> = {}) {
  const sessions = new PilotSessionService(prisma, {
    pepper,
    inviteHours: 24,
    sessionDays: 7,
    now,
    token: () => randomUUID(),
  });
  return new StaffCredentialService(prisma, sessions, new PrismaAuditRepository(prisma), {
    usernamePepper: pepper,
    now,
    ...overrides,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function adminActor(): Promise<ActorContext> {
  const adminUser = await prisma.user.create({ data: { role: 'ADMIN', displayName: '管理人员' } });
  return { userId: adminUser.id, role: 'ADMIN' };
}

function providerInput() {
  return {
  username: `provider.${randomUUID().replaceAll('-', '')}`,
  displayName: '服务人员一',
  temporaryPassword: 'Temporary-pass-2026',
  };
}

function expectMetadataOnlyAudit(serialized: string, secrets: string[]) {
  for (const secret of secrets) expect(serialized).not.toContain(secret);
  expect(serialized).not.toMatch(/"(?:username|password|hash)"/i);
}

describe('StaffCredentialService', () => {
  beforeEach(async () => {
    databaseName = `petcare_staff_credentials_${randomUUID().replaceAll('-', '')}`;
    const testUrl = new URL(databaseBaseUrl);
    testUrl.pathname = `/${databaseName}`;
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    await execFileAsync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schemaPath], {
      env: { ...process.env, DATABASE_URL: testUrl.toString() },
    });
    prisma = new PrismaClient({ datasourceUrl: testUrl.toString() });
    await prisma.$connect();
  }, 60_000);

  afterEach(async () => {
    await prisma?.$disconnect();
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`,
    );
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
  });

  afterAll(async () => { await admin.$disconnect(); });

  it('creates only PROVIDER accounts for an ADMIN and logs in with normalized usernames', async () => {
    const now = () => new Date('2026-09-02T08:00:00Z');
    const service = createService(now);
    const admin = await adminActor();
    const owner = await prisma.user.create({ data: { role: 'OWNER' } });
    const input = providerInput();

    const created = await service.createProvider(admin, input);

    expect(created).toMatchObject({ username: input.username, role: 'PROVIDER', mustChangePassword: true });
    await expect(service.login(created.username.toUpperCase(), input.temporaryPassword, 'ip:127.0.0.1'))
      .resolves.toMatchObject({ mustChangePassword: true, session: { token: expect.any(String) } });
    await expect(service.createProvider({ userId: owner.id, role: 'OWNER' }, input)).rejects.toThrow('FORBIDDEN');
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'STAFF_PROVIDER_CREATED' } });
    const credential = await prisma.staffCredential.findUniqueOrThrow({ where: { userId: created.userId } });
    expectMetadataOnlyAudit(JSON.stringify(event), [input.username, input.temporaryPassword, credential.passwordHash]);
  });

  it('locks both username and IP keys after five failures for ten minutes, and success clears failures', async () => {
    let current = new Date('2026-09-02T08:00:00Z');
    const service = createService(() => current);
    const admin = await adminActor();
    const input = providerInput();
    const account = await service.createProvider(admin, input);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(service.login(account.username, 'wrong-password-value', 'ip:127.0.0.1'))
        .rejects.toThrow('STAFF_LOGIN_INVALID');
    }
    await expect(service.login(account.username, input.temporaryPassword, 'ip:127.0.0.1'))
      .resolves.toMatchObject({ mustChangePassword: true });
    expect(await prisma.staffCredential.findUniqueOrThrow({ where: { userId: account.userId } }))
      .toMatchObject({ failedAttempts: 0, lockedUntil: null });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(service.login(account.username, 'wrong-password-value', 'ip:127.0.0.1'))
        .rejects.toThrow('STAFF_LOGIN_INVALID');
    }
    expect(await prisma.staffCredential.findUniqueOrThrow({ where: { userId: account.userId } }))
      .toMatchObject({ failedAttempts: 5, lockedUntil: new Date('2026-09-02T08:10:00Z') });
    await expect(service.login('different.person', 'wrong-password-value', 'ip:127.0.0.1'))
      .rejects.toThrow('STAFF_LOGIN_INVALID');

    current = new Date('2026-09-02T08:10:01Z');
    await expect(service.login(account.username, input.temporaryPassword, 'ip:127.0.0.1'))
      .resolves.toMatchObject({ mustChangePassword: true });
  });

  it('returns the same invalid-login failure for disabled and unknown accounts', async () => {
    const now = () => new Date('2026-09-02T08:00:00Z');
    const service = createService(now);
    const admin = await adminActor();
    const input = providerInput();
    const account = await service.createProvider(admin, input);
    await service.setDisabled(admin, account.userId, true);

    await expect(service.login(account.username, input.temporaryPassword, 'ip:127.0.0.2'))
      .rejects.toThrow('STAFF_LOGIN_INVALID');
    await expect(service.login('unknown.staff', input.temporaryPassword, 'ip:127.0.0.3'))
      .rejects.toThrow('STAFF_LOGIN_INVALID');
  });

  it('revokes active sessions when an ADMIN resets a provider password and when staff changes it', async () => {
    const now = () => new Date('2026-09-02T08:00:00Z');
    const service = createService(now);
    const admin = await adminActor();
    const input = providerInput();
    const account = await service.createProvider(admin, input);
    const beforeReset = await service.login(account.username, input.temporaryPassword, 'ip:127.0.0.1');
    const secondBeforeReset = await service.login(account.username, input.temporaryPassword, 'ip:127.0.0.2');

    await service.resetPassword(admin, account.userId, 'Reset-password-2026');

    expect(await prisma.pilotSession.count({ where: { userId: account.userId, revokedAt: null } })).toBe(0);
    await expect(service.login(account.username, input.temporaryPassword, 'ip:127.0.0.3'))
      .rejects.toThrow('STAFF_LOGIN_INVALID');
    const afterReset = await service.login(account.username, 'Reset-password-2026', 'ip:127.0.0.3');
    const afterResetCredential = await prisma.staffCredential.findUniqueOrThrow({ where: { userId: account.userId } });
    const changed = await service.changePassword(
      { userId: account.userId, role: 'PROVIDER', staffPasswordChangedAt: afterResetCredential.passwordChangedAt },
      'Changed-password-2026',
    );

    expect(changed).toMatchObject({ mustChangePassword: false, session: { token: expect.any(String) } });
    expect(await prisma.pilotSession.count({ where: { userId: account.userId, revokedAt: null } })).toBe(1);
    expect([beforeReset.session.token, secondBeforeReset.session.token, afterReset.session.token])
      .not.toContain(changed.session.token);
    expect(await prisma.staffCredential.findUniqueOrThrow({ where: { userId: account.userId } }))
      .toMatchObject({ mustChangePassword: false, failedAttempts: 0, lockedUntil: null });
  });

  it('lists provider DTOs and bootstraps exactly one ADMIN without leaking credential material to audit', async () => {
    const now = () => new Date('2026-09-02T08:00:00Z');
    const first = createService(now);
    const second = createService(now);
    const bootstrapInput = {
      username: 'ops.admin', displayName: '系统管理员', temporaryPassword: 'Bootstrap-password-2026',
    };

    const bootstrapped = await Promise.all([
      first.bootstrapInitialAdmin(bootstrapInput),
      second.bootstrapInitialAdmin(bootstrapInput),
    ]);
    const input = providerInput();
    const provider = await first.createProvider({ userId: bootstrapped[0].userId, role: 'ADMIN' }, input);

    expect(bootstrapped[0]).toEqual(bootstrapped[1]);
    expect(await prisma.staffCredential.count({ where: { user: { role: 'ADMIN' } } })).toBe(1);
    await expect(first.list({ userId: bootstrapped[0].userId, role: 'ADMIN' })).resolves.toContainEqual(
      expect.objectContaining({ userId: provider.userId, username: input.username, role: 'PROVIDER' }),
    );
    const events = await prisma.auditEvent.findMany({ where: { entityType: 'User' } });
    const credential = await prisma.staffCredential.findUniqueOrThrow({ where: { userId: bootstrapped[0].userId } });
    expectMetadataOnlyAudit(JSON.stringify(events), [bootstrapInput.username, bootstrapInput.temporaryPassword, credential.passwordHash]);
  });

  it('does not bootstrap another ADMIN when an ADMIN user already exists without a credential', async () => {
    const now = () => new Date('2026-09-02T08:00:00Z');
    const service = createService(now);
    await prisma.user.create({ data: { role: 'ADMIN' } });

    await expect(service.bootstrapInitialAdmin({
      username: 'ops.admin', displayName: '系统管理员', temporaryPassword: 'Bootstrap-password-2026',
    })).rejects.toThrow('ADMIN_BOOTSTRAP_EXISTS');
  });

  it('rejects non-ASCII username source text before case normalization', async () => {
    expect(() => normalizeStaffUsername('Kabc')).toThrow('USERNAME_INVALID');
    expect(() => normalizeStaffUsername('provider。one')).toThrow('USERNAME_INVALID');
  });

  it('expires subthreshold limiter failures and evicts the oldest bounded key', () => {
    const limiter = new StaffLoginLimiter({ maximumEntries: 2, windowMilliseconds: 1_000 });
    const start = new Date('2026-09-02T08:00:00Z');

    for (let attempt = 0; attempt < 4; attempt += 1) limiter.recordFailure('first', start);
    expect(limiter.isLocked('first', start)).toBe(false);
    limiter.recordFailure('first', new Date('2026-09-02T08:00:01Z'));
    expect(limiter.isLocked('first', new Date('2026-09-02T08:00:01Z'))).toBe(false);

    for (let attempt = 0; attempt < 5; attempt += 1) limiter.recordFailure('second', start);
    for (let attempt = 0; attempt < 5; attempt += 1) limiter.recordFailure('third', start);
    expect(limiter.size).toBe(2);
    expect(limiter.isLocked('first', start)).toBe(false);
    expect(limiter.isLocked('second', start)).toBe(true);
    expect(limiter.isLocked('third', start)).toBe(true);
  });

  it('keeps a locked limiter entry through its full lock duration when its failure window is shorter', () => {
    const limiter = new StaffLoginLimiter({ maximumEntries: 2, windowMilliseconds: 1_000 });
    const start = new Date('2026-09-02T08:00:00Z');
    for (let attempt = 0; attempt < 5; attempt += 1) limiter.recordFailure('locked', start);

    expect(limiter.isLocked('locked', new Date('2026-09-02T08:00:01Z'))).toBe(true);
    expect(limiter.isLocked('locked', new Date('2026-09-02T08:10:00Z'))).toBe(false);
  });

  it('bounds concurrent login work before starting extra Argon2 verification or database work', async () => {
    const now = () => new Date('2026-09-02T08:00:00Z');
    const verificationStarted = deferred<void>();
    const releaseVerification = deferred<void>();
    const service = createService(now, {
      loginMaximumConcurrent: 1,
      loginMaximumQueued: 0,
      passwordHasher: {
        hash: async () => 'unused',
        verify: async () => {
          verificationStarted.resolve();
          await releaseVerification.promise;
          return false;
        },
      },
    });

    const first = service.login('unknown.staff', 'any-password', 'ip:127.0.0.1');
    await verificationStarted.promise;
    await expect(service.login('other.staff', 'any-password', 'ip:127.0.0.2'))
      .rejects.toThrow('STAFF_LOGIN_BUSY');
    releaseVerification.resolve();
    await expect(first).rejects.toThrow('STAFF_LOGIN_INVALID');
  });

  it('requires transactional session issuance and leaves no active session after concurrent login and disable', async () => {
    const now = () => new Date('2026-09-02T08:00:00Z');
    const realSessions = new PilotSessionService(prisma, {
      pepper, inviteHours: 24, sessionDays: 7, now, token: () => randomUUID(),
    });
    const sessions = {
      createSessionForUser: async () => { throw new Error('SESSION_MUST_BE_TRANSACTIONAL'); },
      createSessionForUserInTransaction: async (transaction: Parameters<
        PilotSessionService['createSessionForUserInTransaction']
      >[0], userId: string) => realSessions.createSessionForUserInTransaction(transaction, userId),
    };
    const service = new StaffCredentialService(prisma, sessions, new PrismaAuditRepository(prisma), {
      usernamePepper: pepper, now,
    });
    const admin = await adminActor();
    const input = providerInput();
    const account = await service.createProvider(admin, input);

    const [login, disabled] = await Promise.allSettled([
      service.login(account.username, input.temporaryPassword, 'ip:127.0.0.1'),
      service.setDisabled(admin, account.userId, true),
    ]);

    expect(await prisma.pilotSession.count({ where: { userId: account.userId, revokedAt: null } })).toBe(0);
    expect(disabled).toMatchObject({ status: 'fulfilled' });
    if (login.status === 'fulfilled') {
      await expect(realSessions.authenticate(`Bearer ${login.value.session.token}`)).rejects.toThrow('UNAUTHENTICATED');
    } else {
      expect(login.reason).toMatchObject({ message: 'STAFF_LOGIN_INVALID' });
    }
  });

  it('leaves no active replacement session when password change and reset run concurrently', async () => {
    const now = () => new Date('2026-09-02T08:00:00Z');
    const service = createService(now);
    const admin = await adminActor();
    const input = providerInput();
    const account = await service.createProvider(admin, input);

    const results = await Promise.allSettled([
      service.changePassword({ userId: account.userId, role: 'PROVIDER', staffPasswordChangedAt: null }, 'Changed-password-2026'),
      service.resetPassword(admin, account.userId, 'Reset-password-2026'),
    ]);

    expect(results.every((result) => result.status === 'fulfilled'
      || (result.reason as Error).message === 'UNAUTHENTICATED')).toBe(true);
    expect(await prisma.pilotSession.count({ where: { userId: account.userId, revokedAt: null } })).toBe(0);
  });

  it('rejects a stale password-change context when two resets share the same clock instant', async () => {
    const now = () => new Date('2026-09-02T08:00:00Z');
    const service = createService(now);
    const admin = await adminActor();
    const input = providerInput();
    const account = await service.createProvider(admin, input);
    await service.resetPassword(admin, account.userId, 'Reset-password-2026');
    const session = await service.login(account.username, 'Reset-password-2026', 'ip:127.0.0.1');
    const credential = await prisma.staffCredential.findUniqueOrThrow({ where: { userId: account.userId } });
    await service.resetPassword(admin, account.userId, 'Reset-password-two-2026');

    await expect(service.changePassword({
      userId: account.userId, role: 'PROVIDER', staffPasswordChangedAt: credential.passwordChangedAt,
    }, 'Changed-password-2026')).rejects.toThrow('UNAUTHENTICATED');
    expect(await prisma.pilotSession.count({ where: { userId: account.userId, revokedAt: null } })).toBe(0);
    await expect(createService(now).login(account.username, 'Reset-password-two-2026', 'ip:127.0.0.2'))
      .resolves.toMatchObject({ session: { token: expect.any(String) } });
    expect(session.session.token).toMatch(/^[0-9a-f-]+$/);
  });

  it('retries serializable concurrent staff writers instead of surfacing P2034', async () => {
    const now = () => new Date('2026-09-02T08:00:00Z');
    const service = createService(now);
    const admin = await adminActor();
    const input = providerInput();
    const account = await service.createProvider(admin, input);

    await expect(Promise.all([
      service.setDisabled(admin, account.userId, true),
      service.setDisabled(admin, account.userId, false),
    ])).resolves.toHaveLength(2);
    await service.setDisabled(admin, account.userId, false);
    await expect(Promise.all([
      service.resetPassword(admin, account.userId, 'Reset-password-2026'),
      service.resetPassword(admin, account.userId, 'Reset-password-two-2026'),
    ])).resolves.toHaveLength(2);
    const changes = await Promise.allSettled([
      service.changePassword({ userId: account.userId, role: 'PROVIDER', staffPasswordChangedAt: null }, 'Changed-password-2026'),
      service.changePassword({ userId: account.userId, role: 'PROVIDER', staffPasswordChangedAt: null }, 'Changed-password-two-2026'),
    ]);
    expect(changes.every((result) => result.status === 'fulfilled'
      || (result.reason as Error).message === 'UNAUTHENTICATED')).toBe(true);
  });
});
