import {
  Prisma,
  type InvitationStatus,
  type OrderStatus,
  type PrismaClient,
  type ServiceType,
} from '@prisma/client';
import type { ActorContext } from '../auth/auth-service.js';
import { authorizeRole } from '../auth/authorize.js';

const ORDER_INCLUDE = {
  address: { select: { city: true, district: true, serviceZone: true } },
  owner: { select: { displayName: true } },
  assignedProvider: {
    select: { id: true, user: { select: { displayName: true } } },
  },
  invitations: {
    select: {
      id: true,
      providerId: true,
      status: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
  },
  report: {
    select: {
      notes: true,
      submittedAt: true,
      checklist: true,
      media: { select: { id: true }, orderBy: { createdAt: 'asc' as const } },
    },
  },
} satisfies Prisma.OrderInclude;

type PilotOrderRecord = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

export type PilotOrderSummary = {
  id: string;
  serviceType: ServiceType;
  status: OrderStatus;
  startsAt: string;
  durationMinutes: number;
  totalFen: number;
  currency: 'CNY';
  city: string;
  district: string;
  serviceZone: string;
  ownerDisplayName?: string;
  providerDisplayName?: string;
  notes?: string;
  invitation?: { id: string; status: InvitationStatus; expiresAt: string };
  evidence?: Array<{ id: string }>;
  report?: { notes: string; submittedAt: string; checklist: unknown };
};

export type PilotProviderInvitationSummary = {
  id: string;
  serviceType: ServiceType;
  startsAt: string;
  durationMinutes: number;
  city: string;
  district: string;
  serviceZone: string;
  invitation: { id: string; status: InvitationStatus; expiresAt: string };
};

export type PilotOrderView = PilotOrderSummary | PilotProviderInvitationSummary;

export class PilotReadModel {
  public constructor(private readonly prisma: PrismaClient) {}

  public async dashboard(actor: ActorContext) {
    if (actor.role === 'OWNER') {
      const scope = { ownerId: actor.userId } satisfies Prisma.OrderWhereInput;
      const [orders, pendingPayment, pendingConfirmation] = await Promise.all([
        this.prisma.order.count({ where: scope }),
        this.prisma.order.count({ where: { ...scope, status: 'PENDING_PAYMENT' } }),
        this.prisma.order.count({ where: { ...scope, status: 'PENDING_CONFIRMATION' } }),
      ]);
      return {
        role: 'OWNER' as const,
        counts: { orders },
        todos: { pendingPayment, pendingConfirmation },
      };
    }

    if (actor.role === 'PROVIDER') {
      const profile = await this.prisma.providerProfile.findUnique({
        where: { userId: actor.userId }, select: { id: true },
      });
      if (!profile) {
        return {
          role: 'PROVIDER' as const,
          counts: { invitations: 0, assignedOrders: 0 },
          todos: { pendingInvitations: 0, inService: 0 },
        };
      }
      const invitationScope = {
        invitations: { some: { providerId: profile.id, status: 'PENDING' as const } },
      } satisfies Prisma.OrderWhereInput;
      const assignedScope = {
        assignedProviderId: profile.id,
      } satisfies Prisma.OrderWhereInput;
      const [invitations, assignedOrders, inService] = await Promise.all([
        this.prisma.order.count({ where: invitationScope }),
        this.prisma.order.count({ where: assignedScope }),
        this.prisma.order.count({ where: { ...assignedScope, status: 'IN_SERVICE' } }),
      ]);
      return {
        role: 'PROVIDER' as const,
        counts: { invitations, assignedOrders },
        todos: { pendingInvitations: invitations, inService },
      };
    }

    authorizeRole(actor, ['ADMIN']);
    const [orders, pendingProviderReviews, pendingFeeConfirmations, pendingDispatch] = await Promise.all([
      this.prisma.order.count(),
      this.prisma.providerProfile.count({ where: { reviewStatus: 'PENDING' } }),
      this.prisma.order.count({ where: { status: 'PENDING_PAYMENT' } }),
      this.prisma.order.count({ where: { status: 'PENDING_DISPATCH' } }),
    ]);
    return {
      role: 'ADMIN' as const,
      counts: { orders, pendingProviderReviews },
      todos: { pendingFeeConfirmations, pendingDispatch },
    };
  }

  public async orders(actor: ActorContext): Promise<PilotOrderView[]> {
    if (actor.role === 'OWNER') {
      const records = await this.prisma.order.findMany({
        where: { ownerId: actor.userId },
        include: ORDER_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
      });
      return records.map((record) => this.toSummary(record, actor));
    }

    if (actor.role === 'PROVIDER') {
      const profile = await this.prisma.providerProfile.findUnique({
        where: { userId: actor.userId },
        select: { id: true },
      });
      if (!profile) return [];
      const records = await this.prisma.order.findMany({
        where: {
          OR: [
            { assignedProviderId: profile.id },
            { invitations: { some: { providerId: profile.id } } },
          ],
        },
        include: ORDER_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
      });
      return records.map((record) => this.toSummary(record, actor, profile.id));
    }

    authorizeRole(actor, ['ADMIN']);
    const records = await this.prisma.order.findMany({
      include: ORDER_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return records.map((record) => this.toSummary(record, actor));
  }

  public async order(actor: ActorContext, id: string): Promise<PilotOrderView> {
    const record = await this.prisma.order.findUnique({
      where: { id },
      include: ORDER_INCLUDE,
    });
    if (!record) throw new Error('ORDER_NOT_FOUND');

    if (actor.role === 'OWNER') {
      if (record.ownerId !== actor.userId) throw new Error('FORBIDDEN');
      return this.toSummary(record, actor);
    }
    if (actor.role === 'PROVIDER') {
      const profile = await this.prisma.providerProfile.findUnique({
        where: { userId: actor.userId },
        select: { id: true },
      });
      const invited = profile
        ? record.invitations.some((invitation) => invitation.providerId === profile.id)
        : false;
      if (!profile || (record.assignedProviderId !== profile.id && !invited)) {
        throw new Error('FORBIDDEN');
      }
      return this.toSummary(record, actor, profile.id);
    }

    authorizeRole(actor, ['ADMIN']);
    return this.toSummary(record, actor);
  }

  public async reviewQueue(actor: ActorContext) {
    authorizeRole(actor, ['ADMIN']);
    const profiles = await this.prisma.providerProfile.findMany({
      where: { reviewStatus: 'PENDING' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: {
        id: true,
        reviewStatus: true,
        serviceTypes: true,
        catExperienceMonths: true,
        dogExperienceMonths: true,
        serviceZone: true,
        radiusKm: true,
        createdAt: true,
        user: { select: { displayName: true } },
      },
    });
    return profiles.map((profile) => ({
      id: profile.id,
      displayName: profile.user.displayName,
      reviewStatus: profile.reviewStatus,
      serviceTypes: profile.serviceTypes,
      catExperienceMonths: profile.catExperienceMonths,
      dogExperienceMonths: profile.dogExperienceMonths,
      serviceZone: profile.serviceZone,
      radiusKm: Number(profile.radiusKm),
      createdAt: profile.createdAt.toISOString(),
    }));
  }

  public async invites(actor: ActorContext) {
    authorizeRole(actor, ['ADMIN']);
    const records = await this.prisma.pilotInvite.findMany({
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
    return records.map((record) => ({
      id: record.id,
      role: record.role,
      expiresAt: record.expiresAt.toISOString(),
      consumedAt: record.consumedAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
    }));
  }

  private toSummary(
    record: PilotOrderRecord,
    actor: ActorContext,
    providerId?: string,
  ): PilotOrderView {
    const isAdmin = actor.role === 'ADMIN';
    const isOwner = actor.role === 'OWNER';
    const isAssignedProvider = actor.role === 'PROVIDER'
      && providerId !== undefined
      && record.assignedProviderId === providerId;
    const invitation = actor.role === 'PROVIDER' && providerId
      ? record.invitations.find((candidate) => candidate.providerId === providerId)
      : undefined;
    const report = record.report?.submittedAt && (isAdmin || isOwner || isAssignedProvider)
      ? {
          notes: record.report.notes ?? '',
          submittedAt: record.report.submittedAt.toISOString(),
          checklist: record.report.checklist,
        }
      : undefined;

    if (actor.role === 'PROVIDER' && !isAssignedProvider && invitation) {
      return {
        id: record.id,
        serviceType: record.serviceType,
        startsAt: record.startsAt.toISOString(),
        durationMinutes: record.durationMinutes,
        city: record.address.city,
        district: record.address.district,
        serviceZone: record.address.serviceZone,
        invitation: {
          id: invitation.id,
          status: invitation.status,
          expiresAt: invitation.expiresAt.toISOString(),
        },
      };
    }

    return {
      id: record.id,
      serviceType: record.serviceType,
      status: record.status,
      startsAt: record.startsAt.toISOString(),
      durationMinutes: record.durationMinutes,
      totalFen: record.totalFen,
      currency: 'CNY',
      city: record.address.city,
      district: record.address.district,
      serviceZone: record.address.serviceZone,
      ...((isAdmin || isAssignedProvider) && record.owner.displayName !== null
        ? { ownerDisplayName: record.owner.displayName }
        : {}),
      ...(record.assignedProvider?.user.displayName !== null
        && record.assignedProvider?.user.displayName !== undefined
        && (isAdmin || isOwner)
        ? { providerDisplayName: record.assignedProvider.user.displayName }
        : {}),
      ...(isAdmin || isOwner ? { notes: record.notes } : {}),
      ...(invitation ? {
        invitation: {
          id: invitation.id,
          status: invitation.status,
          expiresAt: invitation.expiresAt.toISOString(),
        },
      } : {}),
      ...(isAssignedProvider ? {
        evidence: record.report?.media.map((item) => ({ id: item.id })) ?? [],
      } : {}),
      ...(report ? { report } : {}),
    };
  }
}
