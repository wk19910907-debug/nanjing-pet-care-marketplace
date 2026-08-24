import type { ServiceType } from '@pet/contracts';

export type CandidateProvider = {
  id: string;
  reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  acceptsInvitations: boolean;
  serviceTypes: ServiceType[];
  serviceZone: string;
  distanceKm: number;
  available: boolean;
  hasConflict: boolean;
  activeOrders: number;
  activeOrderLimit: number;
  completionRateBps: number;
  ratingMilli: number;
  matchingExperienceMonths: number;
};

export type DispatchOrder = {
  serviceType: ServiceType;
  serviceZone: string;
  maxDistanceKm: number;
};

export function rankCandidates(
  order: DispatchOrder,
  providers: readonly CandidateProvider[],
): CandidateProvider[] {
  return providers.filter((provider) =>
    provider.reviewStatus === 'APPROVED'
    && provider.acceptsInvitations
    && provider.serviceTypes.includes(order.serviceType)
    && provider.serviceZone === order.serviceZone
    && provider.distanceKm <= order.maxDistanceKm
    && provider.available
    && !provider.hasConflict
    && provider.activeOrders < provider.activeOrderLimit,
  ).sort((left, right) =>
    right.completionRateBps - left.completionRateBps
    || left.distanceKm - right.distanceKm
    || right.ratingMilli - left.ratingMilli
    || right.matchingExperienceMonths - left.matchingExperienceMonths
    || left.activeOrders - right.activeOrders
    || left.id.localeCompare(right.id),
  );
}
