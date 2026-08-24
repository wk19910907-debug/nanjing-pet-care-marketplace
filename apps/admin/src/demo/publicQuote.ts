import type { ServiceType } from './workflow.js';

export const PUBLIC_DISTRICTS = ['建邺区', '鼓楼区', '玄武区', '秦淮区'] as const;
export type PublicDistrict = typeof PUBLIC_DISTRICTS[number];
export type PublicQuoteSelection = { serviceType: ServiceType; district: PublicDistrict };

const prices = {
  CAT_FEEDING: { priceFen: 3200, priceLabel: '¥32' },
  DOG_WALKING: { priceFen: 3700, priceLabel: '¥37' },
} as const;

export function getPublicQuote(serviceType: ServiceType) {
  return prices[serviceType];
}
