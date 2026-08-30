import type { Page } from '@playwright/test';

export async function submitDemoOrder(page: Page, options: {
  serviceType?: 'CAT_FEEDING' | 'DOG_WALKING';
  petName?: string;
  district?: '建邺区' | '鼓楼区' | '玄武区' | '秦淮区';
  address?: string;
} = {}) {
  const orderForm = page.locator('.order-form');
  await orderForm.getByLabel('服务类型').selectOption(options.serviceType ?? 'CAT_FEEDING');
  await orderForm.getByLabel('上门时间').fill('2026-09-01T19:00');
  await orderForm.getByRole('button', { name: '下一步：填写上门信息' }).click();
  await orderForm.getByLabel('宠物昵称').fill(options.petName ?? '团子');
  await orderForm.getByLabel('服务区域').selectOption(options.district ?? '建邺区');
  await orderForm.getByLabel('详细地址').fill(options.address ?? '体验地址 1 号');
  await orderForm.getByRole('button', { name: '下一步：确认预约' }).click();
  await orderForm.getByRole('button', { name: '提交订单' }).click();
}
