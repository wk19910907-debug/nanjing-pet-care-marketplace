import {
  NANJING_DISTRICTS,
  type PublicOperationsCatalog,
  type ServiceType,
} from '@pet/contracts';
import { calculateQuote, type PricingPolicy } from '@pet/domain';
import type { PrismaClient } from '@prisma/client';
import type { ActorContext } from '../auth/auth-service.js';
import { authorizeRole } from '../auth/authorize.js';

export type QuoteRequest = {
  serviceType: ServiceType;
  petIds: string[];
  addressId: string;
  startsAt: Date;
  durationMinutes: number;
};

export interface DistanceCalculator {
  distanceKm(address: {
    latitude: number;
    longitude: number;
    district: string;
    serviceZone: string;
  }): Promise<number>;
}

export interface HolidayCalendar {
  isHoliday(date: Date): boolean;
}

export interface PublicOperationsCatalogReader {
  getPublic(): Promise<PublicOperationsCatalog>;
}

export class QuoteService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly policy: PricingPolicy,
    private readonly distances: DistanceCalculator,
    private readonly holidays: HolidayCalendar,
    private readonly catalog?: PublicOperationsCatalogReader,
  ) {}

  public async quote(actor: ActorContext, request: QuoteRequest) {
    authorizeRole(actor, ['OWNER']);
    const [pets, address] = await Promise.all([
      this.prisma.pet.findMany({ where: { id: { in: request.petIds }, ownerId: actor.userId } }),
      this.prisma.serviceAddress.findFirst({ where: { id: request.addressId, ownerId: actor.userId } }),
    ]);
    if (!address || pets.length !== new Set(request.petIds).size) throw new Error('FORBIDDEN');
    const expectedSpecies = request.serviceType === 'CAT_FEEDING' ? 'CAT_FEEDING' : 'DOG_WALKING';
    if (pets.some((pet) => pet.species !== expectedSpecies)) throw new Error('VALIDATION_ERROR');
    const catalog = await this.catalog?.getPublic();
    if (catalog && !catalog.services[request.serviceType].enabled) {
      throw new Error('SERVICE_NOT_AVAILABLE');
    }
    if (catalog) {
      const districtCode = NANJING_DISTRICTS.find(({ name }) => name === address.district)?.code;
      if (!districtCode || !catalog.openDistricts.includes(districtCode)) {
        throw new Error('AREA_NOT_AVAILABLE');
      }
    }
    const distanceKm = await this.distances.distanceKm({
      latitude: Number(address.latitude),
      longitude: Number(address.longitude),
      district: address.district,
      serviceZone: address.serviceZone,
    });
    const pricingPolicy = catalog
      ? {
          ...this.policy,
          baseFen: {
            CAT_FEEDING: catalog.services.CAT_FEEDING.basePriceFen,
            DOG_WALKING: catalog.services.DOG_WALKING.basePriceFen,
          },
        }
      : this.policy;
    return calculateQuote({
      serviceType: request.serviceType,
      petCount: pets.length,
      durationMinutes: request.durationMinutes,
      distanceKm,
      holiday: this.holidays.isHoliday(request.startsAt),
    }, pricingPolicy);
  }
}
