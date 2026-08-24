import { describe, expect, it } from 'vitest';
import { rankCandidates, type CandidateProvider } from './dispatch.js';

const eligible: CandidateProvider = {
  id: 'provider-a', reviewStatus: 'APPROVED', acceptsInvitations: true,
  serviceTypes: ['CAT_FEEDING'], serviceZone: '奥体东', distanceKm: 1,
  available: true, hasConflict: false, activeOrders: 0, activeOrderLimit: 1,
  completionRateBps: 9800, ratingMilli: 4800, matchingExperienceMonths: 24,
};

describe('rankCandidates', () => {
  it('filters every hard eligibility rule', () => {
    const variants: CandidateProvider[] = [
      eligible,
      { ...eligible, id: 'unverified', reviewStatus: 'PENDING' },
      { ...eligible, id: 'paused', acceptsInvitations: false },
      { ...eligible, id: 'wrong-service', serviceTypes: ['DOG_WALKING'] },
      { ...eligible, id: 'wrong-zone', serviceZone: '河西南' },
      { ...eligible, id: 'far-away', distanceKm: 5.1 },
      { ...eligible, id: 'unavailable', available: false },
      { ...eligible, id: 'conflict', hasConflict: true },
      { ...eligible, id: 'capacity', activeOrders: 1 },
    ];
    expect(rankCandidates({
      serviceType: 'CAT_FEEDING', serviceZone: '奥体东', maxDistanceKm: 5,
    }, variants).map((candidate) => candidate.id)).toEqual(['provider-a']);
  });

  it('sorts deterministically by quality, proximity, experience, load and id', () => {
    const candidates = [
      { ...eligible, id: 'provider-z', distanceKm: 2 },
      { ...eligible, id: 'provider-b', completionRateBps: 9900, distanceKm: 3 },
      { ...eligible, id: 'provider-a', completionRateBps: 9900, distanceKm: 3 },
      { ...eligible, id: 'provider-c', ratingMilli: 4900, distanceKm: 4 },
    ];
    expect(rankCandidates({
      serviceType: 'CAT_FEEDING', serviceZone: '奥体东', maxDistanceKm: 5,
    }, candidates).map((candidate) => candidate.id)).toEqual([
      'provider-a', 'provider-b', 'provider-z', 'provider-c',
    ]);
  });
});
