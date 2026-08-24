import type { QuoteBreakdown, ServiceType } from '@pet/contracts';

export type PricingPolicy = {
  baseFen: Record<ServiceType, number>;
  includedPets: number;
  extraPetFen: number;
  includedMinutes: Record<ServiceType, number>;
  extraDurationBlockMinutes: number;
  extraDurationBlockFen: number;
  includedDistanceKm: number;
  extraDistanceKmFen: number;
  holidayMultiplierBps: number;
};

export type QuoteInput = {
  serviceType: ServiceType;
  petCount: number;
  durationMinutes: number;
  distanceKm: number;
  holiday: boolean;
};

function requireFiniteNonnegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite nonnegative number`);
  }
}

export function calculateQuote(input: QuoteInput, policy: PricingPolicy): QuoteBreakdown {
  if (!Number.isInteger(input.petCount) || input.petCount < 1) {
    throw new RangeError('petCount must be a positive integer');
  }
  requireFiniteNonnegative('durationMinutes', input.durationMinutes);
  requireFiniteNonnegative('distanceKm', input.distanceKm);

  const baseFen = policy.baseFen[input.serviceType];
  const extraPetFen = Math.max(0, input.petCount - policy.includedPets) * policy.extraPetFen;
  const extraMinutes = Math.max(0, input.durationMinutes - policy.includedMinutes[input.serviceType]);
  const durationFen = Math.ceil(extraMinutes / policy.extraDurationBlockMinutes)
    * policy.extraDurationBlockFen;
  const extraDistance = Math.max(0, input.distanceKm - policy.includedDistanceKm);
  const distanceFen = Math.ceil(extraDistance) * policy.extraDistanceKmFen;
  const subtotalFen = baseFen + extraPetFen + durationFen + distanceFen;
  const holidayFen = input.holiday
    ? Math.round(subtotalFen * (policy.holidayMultiplierBps - 10_000) / 10_000)
    : 0;

  return {
    baseFen,
    extraPetFen,
    durationFen,
    distanceFen,
    holidayFen,
    totalFen: subtotalFen + holidayFen,
    currency: 'CNY',
  };
}
