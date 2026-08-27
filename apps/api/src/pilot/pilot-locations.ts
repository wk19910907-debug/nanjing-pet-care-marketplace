export const PILOT_LOCATIONS = [
  { district: '建邺区', latitude: 32.003, longitude: 118.732 },
  { district: '鼓楼区', latitude: 32.066, longitude: 118.769 },
  { district: '玄武区', latitude: 32.048, longitude: 118.798 },
  { district: '秦淮区', latitude: 32.039, longitude: 118.795 },
] as const;

export function pilotLocation(serviceZone: string) {
  return PILOT_LOCATIONS.find((candidate) => candidate.district === serviceZone);
}

export function assertPilotLocation(input: {
  serviceZone: string; latitude: number; longitude: number; radiusKm?: number;
}): void {
  const expected = pilotLocation(input.serviceZone);
  if (!expected
    || input.latitude !== expected.latitude
    || input.longitude !== expected.longitude
    || (input.radiusKm !== undefined && input.radiusKm !== 5)) {
    throw new Error('VALIDATION_ERROR');
  }
}
