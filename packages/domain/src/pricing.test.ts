import { describe, expect, it } from 'vitest';
import { calculateQuote, type PricingPolicy } from './pricing.js';

const policy: PricingPolicy = {
  baseFen: { CAT_FEEDING: 3900, DOG_WALKING: 4900 },
  includedPets: 1,
  extraPetFen: 1000,
  includedMinutes: { CAT_FEEDING: 30, DOG_WALKING: 30 },
  extraDurationBlockMinutes: 20,
  extraDurationBlockFen: 700,
  includedDistanceKm: 3,
  extraDistanceKmFen: 200,
  holidayMultiplierBps: 15000,
};

describe('calculateQuote', () => {
  it('returns the base price for an included service', () => {
    expect(calculateQuote({
      serviceType: 'DOG_WALKING', petCount: 1, durationMinutes: 30,
      distanceKm: 3, holiday: false,
    }, policy)).toEqual({
      baseFen: 4900, extraPetFen: 0, durationFen: 0, distanceFen: 0,
      holidayFen: 0, totalFen: 4900, currency: 'CNY',
    });
  });

  it('prices extra pets and rounds distance up by kilometer', () => {
    expect(calculateQuote({
      serviceType: 'CAT_FEEDING', petCount: 2, durationMinutes: 30,
      distanceKm: 3.1, holiday: false,
    }, policy)).toEqual({
      baseFen: 3900, extraPetFen: 1000, durationFen: 0, distanceFen: 200,
      holidayFen: 0, totalFen: 5100, currency: 'CNY',
    });
  });

  it('rounds extra duration up by configured blocks', () => {
    expect(calculateQuote({
      serviceType: 'DOG_WALKING', petCount: 1, durationMinutes: 51,
      distanceKm: 2, holiday: false,
    }, policy).durationFen).toBe(1400);
  });

  it('applies the holiday multiplier to the subtotal using integer fen', () => {
    expect(calculateQuote({
      serviceType: 'CAT_FEEDING', petCount: 1, durationMinutes: 30,
      distanceKm: 3, holiday: true,
    }, policy)).toMatchObject({ holidayFen: 1950, totalFen: 5850 });
  });

  it('rejects invalid counts, durations and distances', () => {
    expect(() => calculateQuote({
      serviceType: 'CAT_FEEDING', petCount: 0, durationMinutes: 30,
      distanceKm: 1, holiday: false,
    }, policy)).toThrow('petCount');
    expect(() => calculateQuote({
      serviceType: 'CAT_FEEDING', petCount: 1, durationMinutes: -1,
      distanceKm: 1, holiday: false,
    }, policy)).toThrow('durationMinutes');
  });
});
