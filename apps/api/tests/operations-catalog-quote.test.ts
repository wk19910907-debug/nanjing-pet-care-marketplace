import { describe, expect, it } from 'vitest';
import type { PricingPolicy } from '@pet/domain';
import type { PublicOperationsCatalog } from '@pet/contracts';
import { QuoteService } from '../src/catalog/quote-service.js';

const policy: PricingPolicy = {
  baseFen: { CAT_FEEDING: 1, DOG_WALKING: 1 },
  includedPets: 1,
  extraPetFen: 700,
  includedMinutes: { CAT_FEEDING: 25, DOG_WALKING: 30 },
  extraDurationBlockMinutes: 20,
  extraDurationBlockFen: 700,
  includedDistanceKm: 5,
  extraDistanceKmFen: 100,
  holidayMultiplierBps: 10_000,
};

function setup(initial: PublicOperationsCatalog) {
  let catalog = initial;
  const prisma = {
    pet: {
      findMany: async () => [{ id: 'pet-id', species: 'CAT_FEEDING' }],
    },
    serviceAddress: {
      findFirst: async () => ({
        id: 'address-id',
        latitude: 32.003,
        longitude: 118.732,
        district: '建邺区',
        serviceZone: '建邺区',
      }),
    },
  };
  const service = new QuoteService(
    prisma as never,
    policy,
    { distanceKm: async () => 0 },
    { isHoliday: () => false },
    { getPublic: async () => catalog },
  );
  return { service, setCatalog: (next: PublicOperationsCatalog) => { catalog = next; } };
}

const open: PublicOperationsCatalog = {
  services: {
    CAT_FEEDING: { enabled: true, basePriceFen: 3_200 },
    DOG_WALKING: { enabled: true, basePriceFen: 3_700 },
  },
  openDistricts: ['JIANYE'],
  announcement: '',
};

const request = {
  serviceType: 'CAT_FEEDING' as const,
  petIds: ['pet-id'],
  addressId: 'address-id',
  startsAt: new Date('2026-09-10T02:00:00.000Z'),
  durationMinutes: 25,
};

describe('catalog-backed quote service', () => {
  it('rejects a disabled service before calculating a quote', async () => {
    const { service } = setup({
      ...open,
      services: { ...open.services, CAT_FEEDING: { enabled: false, basePriceFen: 3_200 } },
    });
    await expect(service.quote({ userId: 'owner-id', role: 'OWNER' }, request))
      .rejects.toThrow('SERVICE_NOT_AVAILABLE');
  });

  it('rejects an address outside the current open districts', async () => {
    const { service } = setup({ ...open, openDistricts: ['GULOU'] });
    await expect(service.quote({ userId: 'owner-id', role: 'OWNER' }, request))
      .rejects.toThrow('AREA_NOT_AVAILABLE');
  });

  it('uses the catalog price for each new quote without mutating an earlier result', async () => {
    const { service, setCatalog } = setup(open);
    const first = await service.quote({ userId: 'owner-id', role: 'OWNER' }, request);
    setCatalog({
      ...open,
      services: { ...open.services, CAT_FEEDING: { enabled: true, basePriceFen: 3_600 } },
    });
    const second = await service.quote({ userId: 'owner-id', role: 'OWNER' }, request);

    expect(first).toMatchObject({ baseFen: 3_200, totalFen: 3_200 });
    expect(second).toMatchObject({ baseFen: 3_600, totalFen: 3_600 });
    expect(first.totalFen).toBe(3_200);
  });
});
