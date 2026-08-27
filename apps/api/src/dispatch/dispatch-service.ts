import { Prisma, type PrismaClient } from '@prisma/client';
import { rankCandidates } from '@pet/domain';
import type { AuditRepository } from '../audit/audit-repository.js';

export interface DispatchAlertSink {
  notify(alert: { orderId: string; reason: string }): Promise<void>;
}

const INVITATION_TTL_MS = 5 * 60_000;
const MAX_WAVES = 2;
const ACTIVE_STATUSES = ['PENDING_SERVICE', 'IN_SERVICE'] as const;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const deltaLat = radians(lat2 - lat1);
  const deltaLon = radians(lon2 - lon1);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class DispatchService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditRepository,
    private readonly alerts: DispatchAlertSink,
  ) {}

  public async start(orderId: string, now: Date) {
    const pendingProviders = await this.prisma.dispatchInvitation.findMany({
      where: { orderId, status: 'PENDING', expiresAt: { gt: now } },
      select: {
        id: true,
        provider: { select: { reviewStatus: true, acceptsInvitations: true } },
      },
    });
    const ineligibleInvitationIds = pendingProviders
      .filter(({ provider }) => provider.reviewStatus !== 'APPROVED' || !provider.acceptsInvitations)
      .map(({ id }) => id);
    if (ineligibleInvitationIds.length > 0) {
      await this.prisma.dispatchInvitation.updateMany({
        where: { id: { in: ineligibleInvitationIds }, status: 'PENDING' },
        data: { status: 'CANCELLED', respondedAt: now },
      });
    }
    const current = await this.prisma.dispatchInvitation.findMany({
      where: { orderId, status: 'PENDING', expiresAt: { gt: now } },
      orderBy: [{ wave: 'asc' }, { createdAt: 'asc' }],
    });
    if (current.length > 0) return current;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId }, include: { address: true, invitations: true },
    });
    if (!order || order.status !== 'PENDING_DISPATCH') throw new Error('DISPATCH_NOT_ALLOWED');
    const wave = order.invitations.reduce((largest, item) => Math.max(largest, item.wave), 0) + 1;
    if (wave > MAX_WAVES) return this.failClosed(orderId);

    const endsAt = new Date(order.startsAt.getTime() + order.durationMinutes * 60_000);
    const previouslyInvited = new Set(order.invitations.map((item) => item.providerId));
    const profiles = await this.prisma.providerProfile.findMany({
      where: {
        reviewStatus: 'APPROVED', acceptsInvitations: true,
        serviceTypes: { has: order.serviceType }, serviceZone: order.address.serviceZone,
        id: { notIn: [...previouslyInvited] },
      },
      include: {
        availability: { where: { startsAt: { lte: order.startsAt }, endsAt: { gte: endsAt } } },
        assignedOrders: {
          where: {
            status: { in: [...ACTIVE_STATUSES] },
            startsAt: { lt: endsAt },
          },
          select: { startsAt: true, durationMinutes: true },
        },
      },
    });
    const ranked = rankCandidates({
      serviceType: order.serviceType,
      serviceZone: order.address.serviceZone,
      maxDistanceKm: Number.POSITIVE_INFINITY,
    }, profiles.map((profile) => {
      const distanceKm = haversineKm(
        Number(profile.latitude), Number(profile.longitude),
        Number(order.address.latitude), Number(order.address.longitude),
      );
      const hasConflict = profile.assignedOrders.some((assigned) =>
        new Date(assigned.startsAt.getTime() + assigned.durationMinutes * 60_000) > order.startsAt,
      );
      return {
        id: profile.id,
        reviewStatus: profile.reviewStatus,
        acceptsInvitations: profile.acceptsInvitations,
        serviceTypes: profile.serviceTypes,
        serviceZone: profile.serviceZone,
        distanceKm,
        available: profile.availability.length > 0,
        hasConflict,
        activeOrders: profile.assignedOrders.length,
        activeOrderLimit: profile.activeOrderLimit,
        completionRateBps: profile.completionRateBps,
        ratingMilli: profile.ratingMilli,
        matchingExperienceMonths: order.serviceType === 'CAT_FEEDING'
          ? profile.catExperienceMonths : profile.dogExperienceMonths,
        radiusKm: Number(profile.radiusKm),
      };
    }).filter((profile) => profile.distanceKm <= profile.radiusKm)).slice(0, 3);

    if (ranked.length === 0) return wave >= MAX_WAVES ? this.failClosed(orderId) : [];
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
    return this.prisma.$transaction(async (tx) => {
      const invitations = await Promise.all(ranked.map((provider) => tx.dispatchInvitation.create({
        data: { orderId, providerId: provider.id, wave, expiresAt },
      })));
      await this.audit.append({
        actorId: null, actorRole: 'DISPATCHER', action: 'DISPATCH_WAVE_STARTED',
        entityType: 'Order', entityId: orderId,
        metadata: { wave, providerIds: invitations.map((item) => item.providerId), expiresAt: expiresAt.toISOString() },
      }, tx);
      return invitations;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  public async expireWave(orderId: string, now: Date) {
    await this.prisma.dispatchInvitation.updateMany({
      where: { orderId, status: 'PENDING', expiresAt: { lte: now } },
      data: { status: 'EXPIRED', respondedAt: now },
    });
    const latest = await this.prisma.dispatchInvitation.aggregate({
      where: { orderId }, _max: { wave: true },
    });
    if ((latest._max.wave ?? 0) >= MAX_WAVES) return this.failClosed(orderId);
    return this.start(orderId, now);
  }

  public async acceptInvitation(invitationId: string, providerId: string, now: Date) {
    return this.prisma.$transaction(async (tx) => {
      const invitation = await tx.dispatchInvitation.findUniqueOrThrow({
        where: { id: invitationId }, include: { order: true, provider: true },
      });
      if (invitation.providerId !== providerId) throw new Error('FORBIDDEN');
      if (invitation.status !== 'PENDING' || invitation.expiresAt <= now
        || invitation.order.status !== 'PENDING_DISPATCH'
        || invitation.provider.reviewStatus !== 'APPROVED'
        || !invitation.provider.acceptsInvitations) {
        throw new Error('DISPATCH_CONFLICT');
      }
      const claimed = await tx.order.updateMany({
        where: { id: invitation.orderId, status: 'PENDING_DISPATCH', version: invitation.order.version },
        data: { assignedProviderId: providerId, status: 'PENDING_SERVICE', version: { increment: 1 } },
      });
      if (claimed.count !== 1) throw new Error('DISPATCH_CONFLICT');
      await tx.dispatchInvitation.update({
        where: { id: invitationId }, data: { status: 'ACCEPTED', respondedAt: now },
      });
      await tx.dispatchInvitation.updateMany({
        where: { orderId: invitation.orderId, id: { not: invitationId }, status: 'PENDING' },
        data: { status: 'CANCELLED', respondedAt: now },
      });
      await this.audit.append({
        actorId: null, actorRole: 'PROVIDER', action: 'DISPATCH_INVITATION_ACCEPTED',
        entityType: 'Order', entityId: invitation.orderId, metadata: { invitationId, providerId },
      }, tx);
      return tx.order.findUniqueOrThrow({ where: { id: invitation.orderId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async failClosed(orderId: string) {
    const updated = await this.prisma.order.updateMany({
      where: { id: orderId, status: 'PENDING_DISPATCH' },
      data: { status: 'DISPATCH_FAILED', version: { increment: 1 } },
    });
    if (updated.count === 1) {
      await this.audit.append({
        actorId: null, actorRole: 'DISPATCHER', action: 'DISPATCH_FAILED',
        entityType: 'Order', entityId: orderId, metadata: { reason: 'dispatch_exhausted' },
      });
      await this.alerts.notify({ orderId, reason: 'dispatch_exhausted' });
    }
    return [];
  }
}
