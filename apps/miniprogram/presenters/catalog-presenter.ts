import { NANJING_DISTRICTS, type PublicOperationsCatalog, type ServiceType } from '@pet/contracts';

const serviceCopy: Record<ServiceType, { title: string; summary: string }> = {
  CAT_FEEDING: { title: '上门喂猫', summary: '喂食换水、清理猫砂、状态反馈' },
  DOG_WALKING: { title: '上门遛狗', summary: '牵引散步、饮水照看、状态反馈' },
};

const price = (fen: number) => `¥${(fen / 100).toFixed(2)} 起`;

export function presentCatalog(catalog: PublicOperationsCatalog) {
  const serviceCards = (Object.keys(serviceCopy) as ServiceType[])
    .filter((type) => catalog.services[type].enabled)
    .map((type) => ({ type, ...serviceCopy[type], price: price(catalog.services[type].basePriceFen) }));
  const open = new Set(catalog.openDistricts);
  return {
    status: 'ready' as const,
    announcement: catalog.announcement,
    serviceCards,
    districts: NANJING_DISTRICTS.filter(({ code }) => open.has(code)),
    bookingAvailable: serviceCards.length > 0,
  };
}

export function presentCatalogFailure() {
  return {
    status: 'error' as const,
    announcement: '', serviceCards: [], districts: [], bookingAvailable: false,
    errorMessage: '服务信息加载失败，请重试',
  };
}
