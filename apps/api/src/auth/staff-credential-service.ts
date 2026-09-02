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
const DEFAULT_LIMITER_MAXIMUM_ENTRIES = 10_000;
const DEFAULT_LOGIN_MAXIMUM_CONCURRENT = 8;
const DEFAULT_LOGIN_MAXIMUM_QUEUED = 32;
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

export type StaffPasswordActor = ActorContext & {
  staffPasswordChangedAt: Date | null;
};

export type StaffCredentialServiceOptions = {
  usernamePepper: Buffer;
  now?: () => Date;
  limiterMaximumEntries?: number;
  limiterWindowMilliseconds?: number;
  loginMaximumConcurrent?: number;
  loginMaximumQueued?: number;
  passwordHasher?: Pick<PasswordHasher, 'hash' | 'verify'>;
};

export type StaffLoginLimiterOptions = {
  maximumEntries?: number;
  windowMilliseconds?: number;
};

export type StaffLoginWorkLimiterOptions = {
  maximumConcurrent?: number;
  maximumQueued?: number;
};

type RateLimitState = { failures: number; expiresAt: Date; lockedUntil: Date | null };

export class StaffLoginLimiter {
  private readonly states = new Map<string, RateLimitState>();
  private readonly maximumEntries: number;
  private readonly windowMilliseconds: number;

  public constructor(options: StaffLoginLimiterOptions = {}) {
    this.maximumEntries = options.maximumEntries ?? DEFAULT_LIMITER_MAXIMUM_ENTRIES;
    this.windowMilliseconds = options.windowMilliseconds ?? LOCK_DURATION_MILLISECONDS;
    if (!Number.isInteger(this.maximumEntries) || this.maximumEntries < 1
      || !Number.isInteger(this.windowMilliseconds) || this.windowMilliseconds < 1) {
      throw new Error('STAFF_LIMITER_OPTIONS_INVALID');
    }
  }

  public get size(): number { return this.states.size; }

  public isLocked(key: string, now: Date): boolean {
    const current = this.active(key, now);
    if (!current?.lockedUntil) return false;
    return current.lockedUntil > now;
  }

  public recordFailure(key: string, now: Date): void {
    const current = this.active(key, now);
    if (current?.lockedUntil && current.lockedUntil > now) return;
    const failures = (current?.failures ?? 0) + 1;
    if (!current && this.states.size >= this.maximumEntries) {
      const oldest = this.states.keys().next().value as string | undefined;
      if (oldest) this.states.delete(oldest);
    }
    if (current) this.states.delete(key);
    const lockedUntil = failures >= MAXIMUM_FAILURES ? addMilliseconds(now, LOCK_DURATION_MILLISECONDS) : null;
    this.states.set(key, {
      failures,
      expiresAt: lockedUntil && lockedUntil > addMilliseconds(now, this.windowMilliseconds)
        ? lockedUntil
        : addMilliseconds(now, this.windowMilliseconds),
      lockedUntil,
    });
  }

  public reset(key: string): void {
    this.states.delete(key);
  }

  private active(key: string, now: Date): RateLimitState | undefined {
    const current = this.states.get(key);
    if (!current) return undefined;
    if (current.expiresAt <= now) {
      this.states.delete(key);
      return undefined;
    }
    return current;
  }
}

/** Bounds expensive login work across all username and IP keys in this process. */
export class StaffLoginWorkLimiter {
  private activeCount = 0;
  private readonly queued: Array<() => void> = [];
  private readonly maximumConcurrent: number;
  private readonly maximumQueued: number;

  public constructor(options: StaffLoginWorkLimiterOptions = {}) {
    this.maximumConcurrent = options.maximumConcurrent ?? DEFAULT_LOGIN_MAXIMUM_CONCURRENT;
    this.maximumQueued = options.maximumQueued ?? DEFAULT_LOGIN_MAXIMUM_QUEUED;
    if (!Number.isInteger(this.maximumConcurrent) || this.maximumConcurrent < 1
      || !Number.isInteger(this.maximumQueued) || this.maximumQueued < 0) {
      throw new Error('STAFF_LOGIN_WORK_LIMITER_OPTIONS_INVALID');
    }
  }

  public async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maximumConcurrent) {
      if (this.queued.length >= this.maximumQueued) throw new Error('STAFF_LOGIN_BUSY');
      await new Promise<void>((resolve) => this.queued.push(resolve));
    }
    this.activeCount += 1;
    try {
      return await operation();
    } finally {
      this.activeCount -= 1;
      this.queued.shift()?.();
    }
  }
}

function addMilliseconds(value: Date, milliseconds: number): Date {
  return new Date(value.getTime() + milliseconds);
}

function normalizeUsername(value: string): string {
  if (!/^[\x00-\x7F]+$/.test(value)) throw new Error('USERNAME_INVALID');
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

function sameInstant(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime() || (left === null && right === null);
}

function nextPasswordChangedAt(previous: Date | null, now: Date): Date {
  return previous !== null && previous >= now ? addMilliseconds(previous, 1) : now;
}

export class StaffCredentialService {
  private readonly now: () => Date;
  private readonly passwordHasher: Pick<PasswordHasher, 'hash' | 'verify'>;
  private readonly rateLimiter: StaffLoginLimiter;
  private readonly loginWorkLimiter: StaffLoginWorkLimiter;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly sessions: Pick<PilotSessionService, 'createSessionForUserInTransaction'>,
    private readonly audit: AuditRepository = new PrismaAuditRepository(prisma),
    private readonly options: StaffCredentialServiceOptions,
  ) {
    if (options.usernamePepper.byteLength < 32) throw new Error('STAFF_USERNAME_PEPPER_INVALID');
    this.now = options.now ?? (() => new Date());
    this.rateLimiter = new StaffLoginLimiter({
      maximumEntries: options.limiterMaximumEntries ?? DEFAULT_LIMITER_MAXIMUM_ENTRIES,
      windowMilliseconds: options.limiterWindowMilliseconds ?? LOCK_DURATION_MILLISECONDS,
    });
    this.loginWorkLimiter = new StaffLoginWorkLimiter({
      maximumConcurrent: options.loginMaximumConcurrent ?? DEFAULT_LOGIN_MAXIMUM_CONCURRENT,
      maximumQueued: options.loginMaximumQueued ?? DEFAULT_LOGIN_MAXIMUM_QUEUED,
    });
    this.passwordHasher = options.passwordHasher ?? new PasswordHasher();
  }

  public async login(username: string, password: string, ipKey: string): Promise<StaffLoginResult> {
    return this.loginWorkLimiter.run(() => this.loginWithinWorkLimit(username, password, ipKey));
  }

  private async loginWithinWorkLimit(username: string, password: string, ipKey: string): Promise<StaffLoginResult> {
    const normalized = loginUsername(username);
    const usernameKey = this.usernameKey(normalized ?? `invalid\0${username.slice(0, MAXIMUM_LOGIN_NAME_LENGTH)}`);
    const clientKey = this.clientKey(ipKey);
    const now = this.now();
    const passwordToVerify = password.length >= 1 && password.length <= 128 ? password : DUMMY_PASSWORD;
    if (this.rateLimiter.isLocked(usernameKey, now) || this.rateLimiter.isLocked(clientKey, now)) {
      await this.passwordHasher.verify(DUMMY_PASSWORD_HASH, passwordToVerify);
      throw new Error('STAFF_LOGIN_INVALID');
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const snapshot = normalized
          ? await this.prisma.staffCredential.findUnique({
            where: { usernameNormalized: normalized },
            include: { user: { select: { id: true, role: true } } },
          })
          : null;
        const verified = await this.passwordHasher.verify(
          snapshot?.passwordHash ?? DUMMY_PASSWORD_HASH,
          passwordToVerify,
        ) && passwordToVerify === password;
        if (this.rateLimiter.isLocked(usernameKey, this.now()) || this.rateLimiter.isLocked(clientKey, this.now())) {
          throw new Error('STAFF_LOGIN_INVALID');
        }
        const result = await this.prisma.$transaction(async (transaction) => {
          const credential = normalized
            ? await transaction.staffCredential.findUnique({
              where: { usernameNormalized: normalized },
              include: { user: { select: { id: true, role: true } } },
            })
            : null;
          if (!this.sameCredentialVersion(snapshot, credential)) return { retry: true } as const;
          const credentialLocked = credential?.lockedUntil !== null && credential?.lockedUntil !== undefined
            && credential.lockedUntil > now;
          const active = credential !== null && (credential.user.role === 'PROVIDER' || credential.user.role === 'ADMIN')
            && credential.disabledAt === null && !credentialLocked;
          if (!verified || !active) {
            if (credential && credential.disabledAt === null && !credentialLocked && !verified) {
              await this.recordCredentialFailure(transaction, credential.userId, credential.lockedUntil, now);
            }
            return { invalid: true } as const;
          }
          await transaction.staffCredential.update({
            where: { id: credential.id },
            data: { failedAttempts: 0, lockedUntil: null },
          });
          const session = await this.sessions.createSessionForUserInTransaction(transaction, credential.userId, now);
          return { session, mustChangePassword: credential.mustChangePassword } as const;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        if ('retry' in result) continue;
        if ('invalid' in result) {
          this.rateLimiter.recordFailure(usernameKey, now);
          this.rateLimiter.recordFailure(clientKey, now);
          throw new Error('STAFF_LOGIN_INVALID');
        }
        this.rateLimiter.reset(usernameKey);
        this.rateLimiter.reset(clientKey);
        return result;
      } catch (error) {
        if (isRetryable(error) && attempt < 2) continue;
        if (isRetryable(error)) break;
        throw error;
      }
    }
    await this.passwordHasher.verify(DUMMY_PASSWORD_HASH, passwordToVerify);
    throw new Error('STAFF_LOGIN_INVALID');
  }

  public async changePassword(actor: StaffPasswordActor, password: string): Promise<StaffLoginResult> {
    authorizeRole(actor, ['PROVIDER', 'ADMIN']);
    const passwordHash = await this.passwordHasher.hash(password);
    const now = this.now();
    return this.serializable(async (transaction) => {
      const current = await transaction.staffCredential.findUnique({
        where: { userId: actor.userId },
        include: { user: { select: { role: true } } },
      });
      if (!current || (current.user.role !== 'PROVIDER' && current.user.role !== 'ADMIN') || current.disabledAt !== null) {
        throw new Error('FORBIDDEN');
      }
      if (!sameInstant(current.passwordChangedAt, actor.staffPasswordChangedAt)) {
        throw new Error('UNAUTHENTICATED');
      }
      await transaction.staffCredential.update({
        where: { id: current.id },
        data: {
          passwordHash,
          mustChangePassword: false,
          failedAttempts: 0,
          lockedUntil: null,
          passwordChangedAt: nextPasswordChangedAt(current.passwordChangedAt, now),
        },
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
      const session = await this.sessions.createSessionForUserInTransaction(transaction, actor.userId, now);
      return { session, mustChangePassword: false };
    });
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
    const updated = await this.serializable(async (transaction) => {
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
    });
    return this.asProviderDto(updated);
  }

  public async resetPassword(actor: ActorContext, userId: string, temporaryPassword: string): Promise<void> {
    authorizeRole(actor, ['ADMIN']);
    const passwordHash = await this.passwordHasher.hash(temporaryPassword);
    const now = this.now();
    await this.serializable(async (transaction) => {
      const current = await this.providerCredential(transaction, userId);
      await transaction.staffCredential.update({
        where: { userId },
        data: {
          passwordHash,
          mustChangePassword: true,
          failedAttempts: 0,
          lockedUntil: null,
          passwordChangedAt: nextPasswordChangedAt(current.passwordChangedAt, now),
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
    });
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

  private async recordCredentialFailure(
    transaction: Prisma.TransactionClient,
    userId: string,
    previousLock: Date | null,
    now: Date,
  ): Promise<void> {
    const credential = await transaction.staffCredential.update({
      where: { userId },
      data: previousLock !== null && previousLock <= now
        ? { failedAttempts: 1, lockedUntil: null }
        : { failedAttempts: { increment: 1 } },
      select: { id: true, failedAttempts: true },
    });
    if (credential.failedAttempts >= MAXIMUM_FAILURES) {
      await transaction.staffCredential.update({
        where: { id: credential.id },
        data: { failedAttempts: MAXIMUM_FAILURES, lockedUntil: addMilliseconds(now, LOCK_DURATION_MILLISECONDS) },
      });
    }
  }

  private sameCredentialVersion(
    snapshot: {
      id: string;
      passwordHash: string;
      mustChangePassword: boolean;
      passwordChangedAt: Date | null;
    } | null,
    current: {
      id: string;
      passwordHash: string;
      mustChangePassword: boolean;
      passwordChangedAt: Date | null;
    } | null,
  ): boolean {
    if (snapshot === null || current === null) return snapshot === current;
    return snapshot.id === current.id
      && snapshot.passwordHash === current.passwordHash
      && snapshot.mustChangePassword === current.mustChangePassword
      && sameInstant(snapshot.passwordChangedAt, current.passwordChangedAt);
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

  private async serializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (isRetryable(error) && attempt < 2) continue;
        if (isRetryable(error)) throw new Error('STAFF_OPERATION_UNAVAILABLE');
        throw error;
      }
    }
    throw new Error('STAFF_OPERATION_UNAVAILABLE');
  }
}

export { normalizeUsername as normalizeStaffUsername };
