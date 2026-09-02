import { Prisma, type PrismaClient } from '@prisma/client';
import type { AuditRepository } from '../audit/audit-repository.js';
import type { ActorContext } from './auth-service.js';
import {
  digestOwnerRecoveryToken,
  generateOwnerRecoveryToken,
  matchesOwnerRecoveryToken,
  ownerRecoveryLookupPrefix,
} from './owner-recovery-credential.js';
import type { PilotSessionService } from './pilot-session-service.js';
import { GuestOwnerLimiter } from './guest-owner-limiter.js';

const SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;

export type OwnerSessionResult = {
  created: boolean;
  session?: { token: string; expiresAt: Date };
  expiresAt: Date;
};

export type PublicOwnerAccessOptions = {
  pepper: Buffer;
  now?: () => Date;
  guestLimiter?: GuestOwnerLimiter;
};

type RecoveryResult = { token: string; recoveryPath: string };

function isTransactionRetry(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === 'P2034' || error.code === 'P2002');
}

export class PublicOwnerAccessService {
  private readonly pepper: Buffer;
  private readonly now: () => Date;
  private readonly guestLimiter: GuestOwnerLimiter;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly sessions: Pick<PilotSessionService, 'authenticate' | 'createSessionForUser'>,
    private readonly audit: AuditRepository,
    options: PublicOwnerAccessOptions,
  ) {
    if (options.pepper.byteLength < 32) throw new Error('PILOT_AUTH_PEPPER_INVALID');
    this.pepper = options.pepper;
    this.now = options.now ?? (() => new Date());
    this.guestLimiter = options.guestLimiter ?? new GuestOwnerLimiter();
  }

  public async ensureOwnerSession(authorization?: string): Promise<OwnerSessionResult> {
    if (authorization) {
      const actor = await this.sessions.authenticate(authorization);
      if (actor.role !== 'OWNER') throw new Error('FORBIDDEN');
      const expiresAt = 'expiresAt' in actor && actor.expiresAt instanceof Date
        ? actor.expiresAt
        : undefined;
      if (!expiresAt) throw new Error('UNAUTHENTICATED');
      return { created: false, expiresAt };
    }

    const owner = await this.guestLimiter.run(() => this.withSerializableRetries(async (tx) => {
      const user = await tx.user.create({
        data: { role: 'OWNER', displayName: '访客宠主' },
        select: { id: true },
      });
      await this.audit.append({
        actorId: user.id,
        actorRole: 'OWNER',
        action: 'OWNER_GUEST_CREATED',
        entityType: 'User',
        entityId: user.id,
        metadata: { userId: user.id },
      }, tx);
      return user;
    }));
    const session = await this.sessions.createSessionForUser(owner.id);
    return { created: true, session, expiresAt: session.expiresAt };
  }

  public async issueRecovery(actor: ActorContext): Promise<RecoveryResult> {
    return this.writeRecovery(actor, 'issue');
  }

  public async rotateRecovery(actor: ActorContext): Promise<RecoveryResult> {
    return this.writeRecovery(actor, 'rotate');
  }

  public async recover(token: string): Promise<{ token: string; expiresAt: Date }> {
    let lookupPrefix: string;
    try {
      lookupPrefix = ownerRecoveryLookupPrefix(token);
    } catch {
      throw new Error('RECOVERY_INVALID');
    }

    try {
      const ownerId = await this.withSerializableRetries(async (tx) => {
        const candidates = await tx.ownerRecoveryCredential.findMany({
          where: { lookupPrefix },
          take: 9,
          include: { user: { select: { id: true, role: true } } },
        });
        if (candidates.length > 8) throw new Error('RECOVERY_INVALID');

        const matches = candidates.map((candidate) => ({
          candidate,
          matches: matchesOwnerRecoveryToken(this.pepper, token, candidate.tokenHash),
        }));
        const valid = matches.filter(({ candidate, matches: matched }) => (
          matched && candidate.revokedAt === null && candidate.user.role === 'OWNER'
        ));
        if (valid.length !== 1) throw new Error('RECOVERY_INVALID');

        const match = valid[0]!.candidate;
        const now = this.now();
        const updated = await tx.ownerRecoveryCredential.updateMany({
          where: { id: match.id, tokenHash: match.tokenHash, revokedAt: null },
          data: { lastUsedAt: now },
        });
        if (updated.count !== 1) throw new Error('RECOVERY_INVALID');
        await this.audit.append({
          actorId: match.userId,
          actorRole: 'OWNER',
          action: 'OWNER_RECOVERY_USED',
          entityType: 'OwnerRecoveryCredential',
          entityId: match.id,
          metadata: { userId: match.userId, credentialId: match.id },
        }, tx);
        return match.userId;
      });
      return this.sessions.createSessionForUser(ownerId);
    } catch {
      throw new Error('RECOVERY_INVALID');
    }
  }

  private async writeRecovery(actor: ActorContext, operation: 'issue' | 'rotate'): Promise<RecoveryResult> {
    if (actor.role !== 'OWNER') throw new Error('FORBIDDEN');
    const token = generateOwnerRecoveryToken();
    const lookupPrefix = ownerRecoveryLookupPrefix(token);
    const tokenHash = digestOwnerRecoveryToken(this.pepper, token);
    const now = this.now();
    await this.withSerializableRetries(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: actor.userId },
        select: { id: true, role: true },
      });
      if (user?.role !== 'OWNER') throw new Error('FORBIDDEN');

      if (operation === 'issue') {
        const existing = await tx.ownerRecoveryCredential.findUnique({
          where: { userId: user.id },
          select: { id: true },
        });
        if (existing) throw new Error('RECOVERY_ALREADY_ISSUED');
        const credential = await tx.ownerRecoveryCredential.create({
          data: { userId: user.id, lookupPrefix, tokenHash, createdAt: now },
          select: { id: true },
        });
        await this.appendRecoveryAudit(tx, user.id, credential.id, 'OWNER_RECOVERY_ISSUED');
        return;
      }

      const credential = await tx.ownerRecoveryCredential.findUnique({
        where: { userId: user.id },
        select: { id: true, revokedAt: true },
      });
      if (!credential || credential.revokedAt !== null) throw new Error('RECOVERY_NOT_ISSUED');
      const rotated = await tx.ownerRecoveryCredential.updateMany({
        where: { id: credential.id, revokedAt: null },
        data: { lookupPrefix, tokenHash, rotatedAt: now },
      });
      if (rotated.count !== 1) throw new Error('RECOVERY_NOT_ISSUED');
      await this.appendRecoveryAudit(tx, user.id, credential.id, 'OWNER_RECOVERY_ROTATED');
    });
    return { token, recoveryPath: `/#/orders/access/${token}` };
  }

  private async appendRecoveryAudit(
    tx: Prisma.TransactionClient,
    userId: string,
    credentialId: string,
    action: 'OWNER_RECOVERY_ISSUED' | 'OWNER_RECOVERY_ROTATED',
  ): Promise<void> {
    await this.audit.append({
      actorId: userId,
      actorRole: 'OWNER',
      action,
      entityType: 'OwnerRecoveryCredential',
      entityId: credentialId,
      metadata: { userId, credentialId },
    }, tx);
  }

  private async withSerializableRetries<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        lastError = error;
        if (!isTransactionRetry(error) || attempt === SERIALIZABLE_TRANSACTION_ATTEMPTS - 1) throw error;
      }
    }
    throw lastError;
  }
}
