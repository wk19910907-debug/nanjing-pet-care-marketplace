import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaAuditRepository } from '../src/audit/audit-repository.js';
import type { ActorContext } from '../src/auth/auth-service.js';
import { digestOwnerRecoveryToken } from '../src/auth/owner-recovery-credential.js';
import { PilotSessionService } from '../src/auth/pilot-session-service.js';
import { PublicOwnerAccessService } from '../src/auth/public-owner-access-service.js';

const execFileAsync = promisify(execFile);
const databaseName = `petcare_public_owner_${randomUUID().replaceAll('-', '')}`;
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
const pepper = Buffer.alloc(32, 12);

function service(now = new Date('2026-09-02T08:00:00Z')) {
  const sessions = new PilotSessionService(prisma, {
    pepper,
    inviteHours: 24,
    sessionDays: 7,
    now: () => now,
    token: () => randomUUID(),
  });
  return {
    sessions,
    access: new PublicOwnerAccessService(prisma, sessions, new PrismaAuditRepository(prisma), {
      pepper,
      now: () => now,
    }),
  };
}

async function ownerActor(): Promise<ActorContext> {
  const owner = await prisma.user.create({ data: { role: 'OWNER' } });
  return { userId: owner.id, role: 'OWNER' };
}

function expectMetadataOnlyAudit(serialized: string, secrets: string[]) {
  for (const secret of secrets) expect(serialized).not.toContain(secret);
  expect(serialized).not.toContain('lookupPrefix');
  expect(serialized).not.toContain('tokenHash');
  expect(serialized).not.toContain('digest');
}

describe('PublicOwnerAccessService', () => {
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

  it('creates an anonymous guest owner and returns a session only after the owner is committed', async () => {
    const { access, sessions } = service();

    const result = await access.ensureOwnerSession();

    expect(result).toMatchObject({ created: true, session: { token: expect.any(String) } });
    expect(result.session?.expiresAt).toEqual(new Date('2026-09-09T08:00:00Z'));
    const owners = await prisma.user.findMany({ where: { role: 'OWNER' } });
    expect(owners).toHaveLength(1);
    expect(owners[0]).toMatchObject({ displayName: '访客宠主', phoneHash: null, wechatOpenId: null });
    expect(await sessions.authenticate(`Bearer ${result.session!.token}`)).toMatchObject({
      userId: owners[0]!.id,
      role: 'OWNER',
    });
    const events = await prisma.auditEvent.findMany({ where: { action: 'OWNER_GUEST_CREATED' } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: owners[0]!.id, actorRole: 'OWNER', entityType: 'User', entityId: owners[0]!.id });
    expectMetadataOnlyAudit(JSON.stringify(events), [result.session!.token]);
  });

  it('reuses an owner session and rejects non-owner session cookies', async () => {
    const { access, sessions } = service();
    const owner = await ownerActor();
    const ownerSession = await sessions.createSessionForUser(owner.userId);
    const admin = await prisma.user.create({ data: { role: 'ADMIN' } });
    const adminSession = await sessions.createSessionForUser(admin.id);
    const provider = await prisma.user.create({ data: { role: 'PROVIDER' } });
    const providerSession = await sessions.createSessionForUser(provider.id);

    await expect(access.ensureOwnerSession(`Bearer ${ownerSession.token}`)).resolves.toEqual({
      created: false,
      expiresAt: ownerSession.expiresAt,
    });
    await expect(access.ensureOwnerSession(`Bearer ${adminSession.token}`)).rejects.toThrow('FORBIDDEN');
    await expect(access.ensureOwnerSession(`Bearer ${providerSession.token}`)).rejects.toThrow('FORBIDDEN');
    expect(await prisma.user.count()).toBe(4);
  });

  it('allows concurrent issue once, rotates without preserving the old token, and records metadata-only audits', async () => {
    const owner = await ownerActor();
    const { access } = service();

    const issued = await Promise.allSettled([
      access.issueRecovery(owner),
      access.issueRecovery(owner),
    ]);
    const successful = issued.filter((item): item is PromiseFulfilledResult<{ userId: string; token: string; recoveryPath: string }> => item.status === 'fulfilled');
    const failed = issued.filter((item): item is PromiseRejectedResult => item.status === 'rejected');
    expect(successful).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toMatchObject({ message: 'RECOVERY_ALREADY_ISSUED' });
    const first = successful[0]!.value;
    expect(first).toMatchObject({
      userId: owner.userId,
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      recoveryPath: expect.stringMatching(/^\/#\/orders\/access\/[A-Za-z0-9_-]{43}$/),
    });
    expect(first.recoveryPath).not.toContain('?');
    expect(await prisma.ownerRecoveryCredential.count({ where: { userId: owner.userId } })).toBe(1);

    const rotated = await access.rotateRecovery(owner);
    expect(rotated.userId).toBe(owner.userId);
    expect(rotated.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rotated.token).not.toBe(first.token);
    const credential = await prisma.ownerRecoveryCredential.findUniqueOrThrow({ where: { userId: owner.userId } });
    expect(credential.tokenHash).toBe(digestOwnerRecoveryToken(pepper, rotated.token));
    expect(credential.tokenHash).not.toBe(digestOwnerRecoveryToken(pepper, first.token));
    await expect(access.recover(first.token)).rejects.toThrow('RECOVERY_INVALID');

    const events = await prisma.auditEvent.findMany({
      where: { entityType: 'OwnerRecoveryCredential', entityId: credential.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((event) => event.action)).toEqual([
      'OWNER_RECOVERY_ISSUED',
      'OWNER_RECOVERY_ROTATED',
    ]);
    for (const event of events) {
      expect(event).toMatchObject({ actorId: owner.userId, actorRole: 'OWNER', entityType: 'OwnerRecoveryCredential' });
    }
    expectMetadataOnlyAudit(JSON.stringify(events), [first.token, rotated.token, credential.lookupPrefix, credential.tokenHash]);
  });

  it('recovers only one active owner credential, updates last use, and binds the session to that owner', async () => {
    const owner = await ownerActor();
    const other = await ownerActor();
    const { access, sessions } = service();
    const issued = await access.issueRecovery(owner);
    await prisma.ownerRecoveryCredential.create({
      data: {
        userId: other.userId,
        lookupPrefix: issued.token.slice(0, 12),
        tokenHash: digestOwnerRecoveryToken(pepper, 'B'.repeat(43)),
      },
    });

    const recovered = await access.recover(issued.token);

    expect(await sessions.authenticate(`Bearer ${recovered.token}`)).toMatchObject({
      userId: owner.userId,
      role: 'OWNER',
    });
    const credential = await prisma.ownerRecoveryCredential.findUniqueOrThrow({ where: { userId: owner.userId } });
    expect(credential.lastUsedAt).toEqual(new Date('2026-09-02T08:00:00Z'));
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'OWNER_RECOVERY_USED' } });
    expect(event).toMatchObject({ actorId: owner.userId, actorRole: 'OWNER', entityId: credential.id });
    expectMetadataOnlyAudit(JSON.stringify(event), [issued.token, credential.lookupPrefix, credential.tokenHash]);
  });

  it('fails closed for malformed, revoked, ambiguous, and overfull recovery candidate sets', async () => {
    const owner = await ownerActor();
    const { access } = service();
    const issued = await access.issueRecovery(owner);
    const prefix = issued.token.slice(0, 12);
    const credentials = await Promise.all(Array.from({ length: 8 }, async () => {
      const user = await prisma.user.create({ data: { role: 'OWNER' } });
      return prisma.ownerRecoveryCredential.create({
        data: {
          userId: user.id,
          lookupPrefix: prefix,
          tokenHash: digestOwnerRecoveryToken(pepper, randomBytes(32).toString('base64url')),
        },
      });
    }));
    await expect(access.recover('x'.repeat(43))).rejects.toThrow('RECOVERY_INVALID');
    await expect(access.recover('x'.repeat(44))).rejects.toThrow('RECOVERY_INVALID');
    await expect(access.recover('invalid')).rejects.toThrow('RECOVERY_INVALID');
    await expect(access.recover(issued.token)).rejects.toThrow('RECOVERY_INVALID');

    await prisma.ownerRecoveryCredential.delete({ where: { id: credentials[0]!.id } });
    await prisma.ownerRecoveryCredential.update({
      where: { userId: owner.userId }, data: { revokedAt: new Date('2026-09-02T08:01:00Z') },
    });
    await expect(access.recover(issued.token)).rejects.toThrow('RECOVERY_INVALID');

    const provider = await prisma.user.create({ data: { role: 'PROVIDER' } });
    const providerToken = randomBytes(32).toString('base64url');
    await prisma.ownerRecoveryCredential.create({
      data: {
        userId: provider.id,
        lookupPrefix: providerToken.slice(0, 12),
        tokenHash: digestOwnerRecoveryToken(pepper, providerToken),
      },
    });
    await expect(access.recover(providerToken)).rejects.toThrow('RECOVERY_INVALID');
  });
});
