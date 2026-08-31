import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it('loads the actual task rather than defaulting every service to cat feeding', async () => {
  let page: any;
  const api = { getServiceOrder: vi.fn(async () => ({ id: 'order-1', serviceType: 'DOG_WALKING',
    status: 'IN_SERVICE', durationMinutes: 30, evidence: [{ id: 'photo' }] })) };
  vi.stubGlobal('getApp', () => ({ globalData: { api, chooseEvidence: async () => null } }));
  vi.stubGlobal('Page', (definition: any) => { page = { ...definition, data: structuredClone(definition.data),
    setData(value: unknown) { Object.assign(this.data, value); } }; });
  await import('../pages/provider/service/index.js');
  await page.onLoad({ id: 'order-1', serviceType: 'CAT_FEEDING' });
  expect(api.getServiceOrder).toHaveBeenCalledWith('order-1');
  expect(page.data.order.serviceType).toBe('DOG_WALKING');
  expect(page.data.evidenceCount).toBe(1);
  await page.upload();
  expect(page.data.evidenceCount).toBe(1);
  page.onUnload();
});
