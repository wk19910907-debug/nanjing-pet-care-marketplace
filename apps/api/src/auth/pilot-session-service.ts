import { createHash, randomBytes } from 'node:crypto';
import type { ActorRole } from '@pet/contracts';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { ActorContext, AuthService } from './auth-service.js';
import { authorizeRole } from './authorize.js';
import { digestPilotCredential } from './pilot-credential.js';

const DisplayNameSchema = z.string().trim().min(1).max(30).refine(
  (value) => !/(?:1\d{10}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(?:微信|vx|wx)\s*[:：_\-]?[A-Za-z0-9_-]{4,}|\d{6,})/i.test(value),
  'DISPLAY_NAME_INVALID',
);

const ADMIN_CREATABLE_ROLES = ['OWNER', 'PROVIDER'] as const satisfies readonly ActorRole[];
export type PilotInviteRole = (typeof ADMIN_CREATABLE_ROLES)[number];

export const LOCAL_PILOT_ROLES = ['OWNER', 'PROVIDER', 'ADMIN'] as const;
export type LocalPilotRole = (typeof LOCAL_PILOT_ROLES)[number];

const LOCAL_SESSION_TRANSACTION_ATTEMPTS = 3;

export type PilotSessionOptions = {
  pepper: Buffer;
  inviteHours: number;
  sessionDays: number;
  now?: () => Date;
  token?: () => string;
};

type RedeemResult = {
  token: string;
  expiresAt: Date;
};

export type PilotSessionContext = ActorContext & {
  displayName: string | null;
  expiresAt: Date;
};

function addHours(value: Date, hours: number): Date {
  return new Date(value.getTime() + hours * 60 * 60 * 1_000);
}

function addDays(value: Date, days: number): Date {
  return addHours(value, days * 24);
}

function localUserMarker(role: LocalPilotRole): string {
  return createHash('sha256').update(`pilot-local-direct-v1\0${role}`, 'utf8').digest('hex');
}

function bearerToken(authorizationHeader: string | undefined): string {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorizationHeader ?? '');
  if (!match?.[1]) throw new Error('UNAUTHENTICATED');
  return match[1];
}

export class PilotSessionService implements AuthService {
  private readonly pepper: Buffer;
  private readonly inviteHours: number;
  private readonly sessionDays: number;
  private readonly now: () => Date;
  private readonly token: () => string;

  constructor(
    private readonly prisma: PrismaClient,
    options: PilotSessionOptions,
  ) {
    if (options.pepper.byteLength < 32) throw new Error('PILOT_AUTH_PEPPER_INVALID');
    this.pepper = options.pepper;
    this.inviteHours = options.inviteHours;
    this.sessionDays = options.sessionDays;
    this.now = options.now ?? (() => new Date());
    this.token = options.token ?? (() => randomBytes(32).toString('base64url'));
  }

  async bootstrapAdminInvite() {
    const code = this.token();
    const now = this.now();
    const invite = await this.prisma.$transaction(async (tx) => {
      const existingAdmin = await tx.user.findFirst({
        where: { role: 'ADMIN' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const admin = existingAdmin ?? await tx.user.create({ data: { role: 'ADMIN' } });
      return tx.pilotInvite.create({
        data: {
          codeHash: digestPilotCredential(this.pepper, 'invite', code),
          role: 'ADMIN',
          targetUserId: admin.id,
          expiresAt: addHours(now, this.inviteHours),
          createdById: admin.id,
        },
        select: { id: true, role: true, expiresAt: true, createdAt: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { ...invite, code };
  }

  async createInvite(actor: ActorContext, role: PilotInviteRole) {
    authorizeRole(actor, ['ADMIN']);
    if (!(ADMIN_CREATABLE_ROLES as readonly string[]).includes(role)) {
      throw new Error('INVITE_ROLE_INVALID');
    }
    const code = this.token();
    const now = this.now();
    const invite = await this.prisma.pilotInvite.create({
      data: {
        codeHash: digestPilotCredential(this.pepper, 'invite', code),
        role,
        expiresAt: addHours(now, this.inviteHours),
        createdById: actor.userId,
      },
      select: { id: true, role: true, expiresAt: true, createdAt: true },
    });
    return { ...invite, code };
  }

  async redeem(code: string): Promise<RedeemResult> {
    const codeHash = digestPilotCredential(this.pepper, 'invite', code);
    const now = this.now();
    const expiresAt = addDays(now, this.sessionDays);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const invite = await tx.pilotInvite.findFirst({
          where: { codeHash, consumedAt: null, expiresAt: { gt: now } },
        });
        if (!invite) throw new Error('INVITE_INVALID');

        const userId = invite.targetUserId ?? (await tx.user.create({
          data: { role: invite.role },
          select: { id: true },
        })).id;
        const consumed = await tx.pilotInvite.updateMany({
          where: { id: invite.id, consumedAt: null, expiresAt: { gt: now } },
          data: { consumedAt: now, targetUserId: userId },
        });
        if (consumed.count !== 1) throw new Error('INVITE_INVALID');

        const token = this.token();
        const tokenHash = digestPilotCredential(this.pepper, 'session', token);
        await tx.pilotSession.create({
          data: { tokenHash, userId, expiresAt, createdAt: now, lastSeenAt: now },
        });
        return { token, expiresAt };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (
        (error instanceof Error && error.message === 'INVITE_INVALID')
        || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
      ) {
        throw new Error('INVITE_INVALID');
      }
      throw error;
    }
  }

  async createLocalSession(role: LocalPilotRole): Promise<{ token: string; expiresAt: Date }> {
    if (!(LOCAL_PILOT_ROLES as readonly string[]).includes(role)) {
      throw new Error('LOCAL_SESSION_ROLE_INVALID');
    }

    const marker = localUserMarker(role);
    const now = this.now();
    const expiresAt = addDays(now, this.sessionDays);
    const token = this.token();
    const tokenHash = digestPilotCredential(this.pepper, 'session', token);

    for (let attempt = 0; attempt < LOCAL_SESSION_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const user = await tx.user.upsert({
            where: { phoneHash: marker },
            create: { phoneHash: marker, role },
            update: {},
            select: { id: true, role: true },
          });
          if (user.role !== role) throw new Error('LOCAL_SESSION_UNAVAILABLE');

          await tx.pilotSession.create({
            data: { tokenHash, userId: user.id, expiresAt, createdAt: now, lastSeenAt: now },
          });
          return { token, expiresAt };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError
          && error.code === 'P2034'
        ) {
          continue;
        }
        throw error;
      }
    }

    throw new Error('LOCAL_SESSION_UNAVAILABLE');
  }

  async authenticate(authorizationHeader: string | undefined): Promise<PilotSessionContext> {
    const raw = bearerToken(authorizationHeader);
    const tokenHash = digestPilotCredential(this.pepper, 'session', raw);
    const now = this.now();
    const session = await this.prisma.pilotSession.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
      include: { user: { select: { id: true, role: true, displayName: true } } },
    });
    if (!session) throw new Error('UNAUTHENTICATED');

    const active = await this.prisma.pilotSession.updateMany({
      where: { id: session.id, revokedAt: null, expiresAt: { gt: now } },
      data: { lastSeenAt: now },
    });
    if (active.count !== 1) throw new Error('UNAUTHENTICATED');
    return {
      userId: session.user.id,
      role: session.user.role,
      displayName: session.user.displayName,
      expiresAt: session.expiresAt,
    };
  }

  async revoke(authorizationHeader: string | undefined): Promise<void> {
    const raw = bearerToken(authorizationHeader);
    const tokenHash = digestPilotCredential(this.pepper, 'session', raw);
    const now = this.now();
    const revoked = await this.prisma.pilotSession.updateMany({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now },
    });
    if (revoked.count !== 1) throw new Error('UNAUTHENTICATED');
  }

  async setDisplayName(actor: ActorContext, value: string) {
    const parsed = DisplayNameSchema.safeParse(value);
    if (!parsed.success) throw new Error('DISPLAY_NAME_INVALID');
    return this.prisma.user.update({
      where: { id: actor.userId },
      data: { displayName: parsed.data },
      select: { id: true, role: true, displayName: true },
    });
  }

  async listInvites(actor: ActorContext) {
    authorizeRole(actor, ['ADMIN']);
    return this.prisma.pilotInvite.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: {
        id: true,
        role: true,
        expiresAt: true,
        consumedAt: true,
        createdAt: true,
      },
    });
  }
}
