import type { ReviewStatus, ServiceType, PrismaClient } from '@prisma/client';
import type { ActorContext } from '../auth/auth-service.js';
import { authorizeRole } from '../auth/authorize.js';
import type { AuditRepository } from '../audit/audit-repository.js';

export type ProviderApplication = {
  serviceTypes: ServiceType[];
  serviceZone: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  catExperienceMonths: number;
  dogExperienceMonths: number;
};

export class ProviderService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditRepository,
  ) {}

  public async getProfile(actor: ActorContext) {
    authorizeRole(actor, ['PROVIDER']);
    const profile = await this.prisma.providerProfile.findUnique({ where: { userId: actor.userId } });
    if (!profile) throw new Error('PROVIDER_NOT_FOUND');
    return profile;
  }

  public async apply(actor: ActorContext, application: ProviderApplication) {
    authorizeRole(actor, ['PROVIDER']);
    if (application.serviceTypes.length === 0 || application.radiusKm <= 0) {
      throw new Error('VALIDATION_ERROR');
    }
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.providerProfile.create({
        data: { userId: actor.userId, ...application },
      });
      await this.audit.append({
        actorId: actor.userId, actorRole: actor.role, action: 'PROVIDER_APPLIED',
        entityType: 'ProviderProfile', entityId: profile.id,
        metadata: { serviceTypes: profile.serviceTypes, serviceZone: profile.serviceZone },
      }, tx);
      return profile;
    });
  }

  public async review(actor: ActorContext, profileId: string, status: ReviewStatus) {
    authorizeRole(actor, ['REVIEWER', 'ADMIN']);
    if (!['APPROVED', 'REJECTED', 'SUSPENDED'].includes(status)) {
      throw new Error('VALIDATION_ERROR');
    }
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.providerProfile.update({
        where: { id: profileId }, data: { reviewStatus: status },
      });
      await this.audit.append({
        actorId: actor.userId, actorRole: actor.role, action: 'PROVIDER_REVIEWED',
        entityType: 'ProviderProfile', entityId: profile.id, metadata: { status },
      }, tx);
      return profile;
    });
  }

  public async setAvailability(
    actor: ActorContext,
    interval: { startsAt: Date; endsAt: Date },
  ) {
    authorizeRole(actor, ['PROVIDER']);
    if (interval.endsAt <= interval.startsAt) throw new Error('VALIDATION_ERROR');
    const profile = await this.getProfile(actor);
    return this.prisma.$transaction(async (tx) => {
      const availability = await tx.providerAvailability.create({
        data: { providerId: profile.id, ...interval },
      });
      await this.audit.append({
        actorId: actor.userId, actorRole: actor.role, action: 'PROVIDER_AVAILABILITY_SET',
        entityType: 'ProviderProfile', entityId: profile.id,
        metadata: { startsAt: interval.startsAt.toISOString(), endsAt: interval.endsAt.toISOString() },
      }, tx);
      return availability;
    });
  }
}
