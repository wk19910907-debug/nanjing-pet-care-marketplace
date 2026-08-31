import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
const roles = ['OWNER', 'PROVIDER'] as const;
async function setup(role: typeof roles[number]) {
  let page: any;
  let savedName: string | null = null;
  const account = () => ({ userId: 'user-1', role, displayName: savedName, expiresAt: '2099-01-01T00:00:00Z' });
  const access = { load: vi.fn(async () => account()), save: vi.fn(async (_role: string, name: string) => { savedName = name; return account(); }) };
  const api = { getCatalog: vi.fn(async () => ({ services: { CAT_FEEDING: { enabled: true, basePriceFen: 3000 }, DOG_WALKING: { enabled: true, basePriceFen: 3500 } }, openDistricts: ['JIANYE'], announcement: '' })),
    listPets: vi.fn(async () => []), listAddresses: vi.fn(async () => []), listProviderTasks: vi.fn(async () => []), createOrder: vi.fn(), quote: vi.fn() };
  vi.stubGlobal('getApp', () => ({ globalData: { access, api } }));
  vi.stubGlobal('wx', { showToast: vi.fn(), navigateTo: vi.fn() });
  vi.stubGlobal('Page', (definition: any) => { page = { ...definition, data: structuredClone(definition.data), setData: vi.fn(function (this: any, value: unknown) { Object.assign(this.data, value); }) }; });
  if (role === 'OWNER') await import('../pages/owner/order-create/index.js');
  else await import('../pages/provider/invitations/index.js');
  await page.onLoad({ serviceType: 'DOG_WALKING' });
  return { page, access, api, business: role === 'OWNER' ? api.getCatalog : api.listProviderTasks };
}
it.each(roles)('%s first use asks only for nickname before fetching business data', async (role) => {
  const { page, access, business } = await setup(role);
  expect(page.data.needsProfile).toBe(true); expect(business).not.toHaveBeenCalled();
  page.changeDisplayName({ detail: { value: '小橘' } });
  await page.saveProfile();
  expect(access.save).toHaveBeenCalledWith(role, '小橘'); expect(page.data.needsProfile).toBe(false);
  expect(business).toHaveBeenCalledOnce(); expect(access.load).toHaveBeenCalledTimes(2);
});
it.each(roles)('%s failed profile save retains text and blocks business', async (role) => {
  const { page, access, business } = await setup(role);
  access.save.mockRejectedValueOnce(new Error('NETWORK_UNAVAILABLE'));
  page.changeDisplayName({ detail: { value: '小橘' } }); await page.saveProfile();
  expect(page.data.displayName).toBe('小橘'); expect(page.data.needsProfile).toBe(true);
  expect(page.data.profileError).not.toBe(''); expect(business).not.toHaveBeenCalled();
});
it.each(roles)('%s blocks duplicate saves and ignores completion after unload', async (role) => {
  const { page, access, business } = await setup(role);
  let finish!: () => void;
  access.save.mockImplementationOnce(async () => { await new Promise<void>((resolve) => { finish = resolve; }); return { userId: 'user-1', role, displayName: '小橘', expiresAt: '2099-01-01T00:00:00Z' }; });
  page.changeDisplayName({ detail: { value: '小橘' } }); const first = page.saveProfile(); await page.saveProfile();
  expect(access.save).toHaveBeenCalledOnce(); page.onUnload(); page.setData.mockClear(); finish(); await first;
  expect(page.setData).not.toHaveBeenCalled(); expect(business).not.toHaveBeenCalled();
});
it.each(roles)('%s rejects empty nickname locally', async (role) => {
  const { page, access } = await setup(role);
  page.changeDisplayName({ detail: { value: ' ' } }); await page.saveProfile();
  expect(access.save).not.toHaveBeenCalled(); expect(page.data.profileError).not.toBe('');
});
it.each(['quote', 'submit'] as const)('ignores owner %s responses after unloading', async (operation) => {
  const { page, api } = await setup('OWNER');
  page.changeDisplayName({ detail: { value: '小橘' } }); await page.saveProfile();
  page.setData({ pets: [{ id: 'pet-1' }], addresses: [{ id: 'address-1' }], startsAt: '2099-01-01T00:00:00Z', quote: {} });
  let finish!: (result: any) => void;
  const result = new Promise((resolve) => { finish = resolve; });
  (operation === 'quote' ? api.quote : api.createOrder).mockReturnValueOnce(result);
  const pending = operation === 'quote' ? page.refreshQuote() : page.submit();
  page.onUnload(); page.setData.mockClear(); finish({ id: 'order-1' }); await pending;
  expect(page.setData).not.toHaveBeenCalled(); expect(wx.showToast).not.toHaveBeenCalled(); expect(wx.navigateTo).not.toHaveBeenCalled();
});
