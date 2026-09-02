import { createHmac } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { ActorContext } from './auth-service.js';
import { PrismaAuditRepository, type AuditRepository } from '../audit/audit-repository.js';
import { authorizeRole } from './authorize.js';
import { PasswordHasher } from './password-hasher.js';
import type { PilotSessionService } from './pilot-session-service.js';

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const MAXIMUM_LOGIN_NAME_LENGTH = 256;
const MAXIMUM_FAILURES = 5;
const LOCK_DURATION_MILLISECONDS = 10 * 60 * 1_000;
const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=19456,p=1,t=2$M4G/wSx/4x1W8pLMNGQqOA$+4kpsw1biX1TRbn0QQ1PYY7fKCVjfWNLidfiCVyIVjU';
const DUMMY_PASSWORD = 'staff-login-dummy-password-value';

export type StaffLoginResult = {
  session: { token: string; expiresAt: Date };
  mustChangePassword: boolean;
};

export type StaffAccountDto = {
  userId: string;
  username: string;
  displayName: string;
  role: 'PROVIDER';
  mustChangePassword: boolean;
  disabledAt: string | null;
  createdAt: string;
};

export type CreateProviderInput = {
  username: string;
  displayName: string;
  temporaryPassword: string;
};

export type InitialAdminInput = CreateProviderInput;

export type StaffCredentialServiceOptions = {
  usernamePepper: Buffer;
  now?: () => Date;
};

type RateLimitState = { failures: number; lockedUntil: Date | null };

class LoginRateLimiter {
  private readonly states = new Map<string, RateLimitState>();

  isLocked(key: string, now: Date): boolean {
    const current = this.states.get(key);
    if (!current?.lockedUntil) return false;
    if (current.lockedUntil > now) return true;
    this.states.delete(key);
    return false;
  }

  recordFailure(key: string, now: Date): void {
    const current = this.states.get(key);
    if (current?.lockedUntil && current.lockedUntil > now) return;
    const failures = (current?.failures ?? 0) + 1;
    this.states.set(key, {
      failures,
      lockedUntil: failures >= MAXIMUM_FAILURES ? addMilliseconds(now, LOCK_DURATION_MILLISECONDS) : null,
    });
  }

  reset(key: string): void {
    this.states.delete(key);
  }
}

function addMilliseconds(value: Date, milliseconds: number): Date {
  return new Date(value.getTime() + milliseconds);
}

function normalizeUsername(value: string): string {
  const normalized = value.toLowerCase();
  if (!USERNAME_PATTERN.test(normalized)) throw new Error('USERNAME_INVALID');
  return normalized;
}

function loginUsername(value: string): string | undefined {
  if (value.length > MAXIMUM_LOGIN_NAME_LENGTH) return undefined;
  try {
    return normalizeUsername(value);
  } catch {
    return undefined;
  }
}

function validateDisplayName(value: string): string {
  const displayName = value.trim();
  if (!displayName || displayName.length > 30) throw new Error('DISPLAY_NAME_INVALID');
  return displayName;
}

function isRetryable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code);
}

export class StaffCredentialService {
  private readonly now: () => Date;
  private readonly passwordHasher = new PasswordHasher();
  private readonly rateLimiter = new LoginRateLimiter();

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly sessions: Pick<PilotSessionService, 'createSessionForUser'>,
    private readonly audit: AuditRepository = new PrismaAuditRepository(prisma),
    private readonly options: StaffCredentialServiceOptions,
  ) {
    if (options.usernamePepper.byteLength < 32) throw new Error('STAFF_USERNAME_PEPPER_INVALID');
    this.now = options.now ?? (() => new Date());
  }

  public async login(username: string, password: string, ipKey: string): Promise<StaffLoginResult> {
    const normalized = loginUsername(username);
    const usernameKey = this.usernameKey(normalized ?? `invalid\0${username.slice(0, MAXIMUM_LOGIN_NAME_LENGTH)}`);
    const clientKey = this.clientKey(ipKey);
    const now = this.now();
    const credential = normalized
      ? await this.prisma.staffCredential.findUnique({
        where: { usernameNormalized: normalized },
        include: { user: { select: { id: true, role: true } } },
      })
      : null;
    const passwordToVerify = password.length >= 1 && password.length <= 128 ? password : DUMMY_PASSWORD;
    const verified = await this.passwordHasher.verify(
      credential?.passwordHash ?? DUMMY_PASSWORD_HASH,
      passwordToVerify,
    ) && passwordToVerify === password;
    const rateLocked = this.rateLimiter.isLocked(usernameKey, now) || this.rateLimiter.isLocked(clientKey, now);
    const credentialLocked = credential?.lockedUntil !== null && credential?.lockedUntil !== undefined
      && credential.lockedUntil > now;
    const active = credential !== null && (credential.user.role === 'PROVIDER' || credential.user.role === 'ADMIN')
      && credential.disabledAt === null && !credentialLocked;

    if (!verified || !active || rateLocked) {
      this.rateLimiter.recordFailure(usernameKey, now);
      this.rateLimiter.recordFailure(clientKey, now);
      if (credential && credential.disabledAt === null && !credentialLocked && !verified) {
        await this.recordCredentialFailure(credential.userId, credential.lockedUntil, now);
      }
      throw new Error('STAFF_LOGIN_INVALID');
    }

    await this.prisma.staffCredential.update({
      where: { id: credential.id },
      data: { failedAttempts: 0, lockedUntil: null },
    });
    this.rateLimiter.reset(usernameKey);
    this.rateLimiter.reset(clientKey);
    const session = await this.sessions.createSessionForUser(credential.userId);
    return { session, mustChangePassword: credential.mustChangePassword };
  }

  public async changePassword(actor: ActorContext, password: string): Promise<StaffLoginResult> {
    authorizeRole(actor, ['PROVIDER', 'ADMIN']);
    const passwordHash = await this.passwordHasher.hash(password);
    const now = this.now();
    const credential = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.staffCredential.findUnique({
        where: { userId: actor.userId },
        include: { user: { select: { role: true } } },
      });
      if (!current || (current.user.role !== 'PROVIDER' && current.user.role !== 'ADMIN') || current.disabledAt !== null) {
        throw new Error('FORBIDDEN');
      }
      const updated = await transaction.staffCredential.update({
        where: { id: current.id },
        data: {
          passwordHash,
          mustChangePassword: false,
          failedAttempts: 0,
          lockedUntil: null,
          passwordChangedAt: now,
        },
        select: { userId: true },
      });
      await transaction.pilotSession.updateMany({
        where: { userId: actor.userId, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
      await this.audit.append({
        actorId: actor.userId,
        actorRole: actor.role,
        action: 'STAFF_PASSWORD_CHANGED',
        entityType: 'User',
        entityId: actor.userId,
        metadata: { mustChangePassword: false },
      }, transaction);
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const session = await this.sessions.createSessionForUser(credential.userId);
    return { session, mustChangePassword: false };
  }

  public async list(actor: ActorContext): Promise<StaffAccountDto[]> {
    authorizeRole(actor, ['ADMIN']);
    const credentials = await this.prisma.staffCredential.findMany({
      where: { user: { role: 'PROVIDER' } },
      include: { user: { select: { id: true, displayName: true, role: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return credentials.map((credential) => this.asProviderDto(credential));
  }

  public async createProvider(actor: ActorContext, input: CreateProviderInput): Promise<StaffAccountDto> {
    authorizeRole(actor, ['ADMIN']);
    const username = normalizeUsername(input.username);
    const displayName = validateDisplayName(input.displayName);
    const passwordHash = await this.passwordHasher.hash(input.temporaryPassword);
    const now = this.now();
    try {
      const created = await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: { role: 'PROVIDER', displayName },
          select: { id: true, displayName: true, role: true },
        });
        const credential = await transaction.staffCredential.create({
          data: { userId: user.id, usernameNormalized: username, passwordHash, createdAt: now },
        });
        await this.audit.append({
          actorId: actor.userId,
          actorRole: 'ADMIN',
          action: 'STAFF_PROVIDER_CREATED',
          entityType: 'User',
          entityId: user.id,
          metadata: { role: 'PROVIDER', mustChangePassword: true },
        }, transaction);
        return { user, credential };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return this.asProviderDto({ ...created.credential, user: created.user });
    } catch (error) {
      if (isRetryable(error)) throw new Error('USERNAME_UNAVAILABLE');
      throw error;
    }
  }

  public async setDisabled(actor: ActorContext, userId: string, disabled: boolean): Promise<StaffAccountDto> {
    authorizeRole(actor, ['ADMIN']);
    const now = this.now();
    const updated = await this.prisma.$transaction(async (transaction) => {
      const current = await this.providerCredential(transaction, userId);
      const credential = await transaction.staffCredential.update({
        where: { id: current.id },
        data: { disabledAt: disabled ? now : null, failedAttempts: 0, lockedUntil: null },
      });
      await transaction.pilotSession.updateMany({
        where: { userId, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
      await this.audit.append({
        actorId: actor.userId,
        actorRole: 'ADMIN',
        action: disabled ? 'STAFF_ACCOUNT_DISABLED' : 'STAFF_ACCOUNT_ENABLED',
        entityType: 'User',
        entityId: userId,
        metadata: { role: 'PROVIDER', disabled },
      }, transaction);
      return { ...credential, user: current.user };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.asProviderDto(updated);
  }

  public async resetPassword(actor: ActorContext, userId: string, temporaryPassword: string): Promise<void> {
    authorizeRole(actor, ['ADMIN']);
    const passwordHash = await this.passwordHasher.hash(temporaryPassword);
    const now = this.now();
    await this.prisma.$transaction(async (transaction) => {
      await this.providerCredential(transaction, userId);
      await transaction.staffCredential.update({
        where: { userId },
        data: {
          passwordHash,
          mustChangePassword: true,
          failedAttempts: 0,
          lockedUntil: null,
          passwordChangedAt: now,
        },
      });
      await transaction.pilotSession.updateMany({
        where: { userId, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
      await this.audit.append({
        actorId: actor.userId,
        actorRole: 'ADMIN',
        action: 'STAFF_PASSWORD_RESET',
        entityType: 'User',
        entityId: userId,
        metadata: { role: 'PROVIDER', mustChangePassword: true },
      }, transaction);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  public async bootstrapInitialAdmin(input: InitialAdminInput): Promise<{ userId: string; username: string }> {
    const username = normalizeUsername(input.username);
    const displayName = validateDisplayName(input.displayName);
    const passwordHash = await this.passwordHasher.hash(input.temporaryPassword);
    const now = this.now();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (transaction) => {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('petcare-staff-admin-bootstrap-v1'))`;
          const sameUsername = await transaction.staffCredential.findUnique({
            where: { usernameNormalized: username },
            include: { user: { select: { id: true, role: true } } },
          });
          if (sameUsername?.user.role === 'ADMIN') {
            return { userId: sameUsername.user.id, username };
          }
          if (sameUsername) throw new Error('USERNAME_UNAVAILABLE');
          const existing = await transaction.user.findFirst({
            where: { role: 'ADMIN' },
            select: { id: true },
          });
          if (existing) throw new Error('ADMIN_BOOTSTRAP_EXISTS');
          const user = await transaction.user.create({
            data: { role: 'ADMIN', displayName },
            select: { id: true },
          });
          await transaction.staffCredential.create({
            data: { userId: user.id, usernameNormalized: username, passwordHash, createdAt: now },
          });
          await this.audit.append({
            actorId: user.id,
            actorRole: 'ADMIN',
            action: 'STAFF_ADMIN_BOOTSTRAPPED',
            entityType: 'User',
            entityId: user.id,
            metadata: { role: 'ADMIN', mustChangePassword: true },
          }, transaction);
          return { userId: user.id, username };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (isRetryable(error) && attempt < 2) continue;
        throw error;
      }
    }
    throw new Error('ADMIN_BOOTSTRAP_UNAVAILABLE');
  }

  private async recordCredentialFailure(userId: string, previousLock: Date | null, now: Date): Promise<void> {
    const credential = await this.prisma.staffCredential.update({
      where: { userId },
      data: previousLock !== null && previousLock <= now
        ? { failedAttempts: 1, lockedUntil: null }
        : { failedAttempts: { increment: 1 } },
      select: { id: true, failedAttempts: true },
    });
    if (credential.failedAttempts >= MAXIMUM_FAILURES) {
      await this.prisma.staffCredential.update({
        where: { id: credential.id },
        data: { failedAttempts: MAXIMUM_FAILURES, lockedUntil: addMilliseconds(now, LOCK_DURATION_MILLISECONDS) },
      });
    }
  }

  private usernameKey(value: string): string {
    return createHmac('sha256', this.options.usernamePepper)
      .update(`staff-login-username-v1\0${value}`, 'utf8').digest('hex');
  }

  private clientKey(value: string): string {
    return createHmac('sha256', this.options.usernamePepper)
      .update(`staff-login-client-v1\0${value.slice(0, MAXIMUM_LOGIN_NAME_LENGTH)}`, 'utf8').digest('hex');
  }

  private async providerCredential(transaction: Prisma.TransactionClient, userId: string) {
    const credential = await transaction.staffCredential.findUnique({
      where: { userId },
      include: { user: { select: { id: true, displayName: true, role: true } } },
    });
    if (!credential || credential.user.role !== 'PROVIDER') throw new Error('STAFF_ACCOUNT_NOT_FOUND');
    return credential;
  }

  private asProviderDto(credential: {
    userId: string;
    usernameNormalized: string;
    mustChangePassword: boolean;
    disabledAt: Date | null;
    createdAt: Date;
    user: { id: string; displayName: string | null; role: string };
  }): StaffAccountDto {
    if (credential.user.role !== 'PROVIDER') throw new Error('STAFF_ACCOUNT_NOT_FOUND');
    return {
      userId: credential.userId,
      username: credential.usernameNormalized,
      displayName: credential.user.displayName ?? '',
      role: 'PROVIDER',
      mustChangePassword: credential.mustChangePassword,
      disabledAt: credential.disabledAt?.toISOString() ?? null,
      createdAt: credential.createdAt.toISOString(),
    };
  }
}

export { normalizeUsername as normalizeStaffUsername };
