export const PILOT_DISTRICTS = [
  { district: '建邺区', zone: '建邺区', latitude: 32.003, longitude: 118.732 },
  { district: '鼓楼区', zone: '鼓楼区', latitude: 32.066, longitude: 118.769 },
  { district: '玄武区', zone: '玄武区', latitude: 32.048, longitude: 118.798 },
  { district: '秦淮区', zone: '秦淮区', latitude: 32.039, longitude: 118.795 },
] as const;

export type PilotDistrict = typeof PILOT_DISTRICTS[number];
export type PilotDistrictName = PilotDistrict['district'];

export function pilotDistrict(name: string): PilotDistrict | undefined {
  return PILOT_DISTRICTS.find((candidate) => candidate.district === name);
}
