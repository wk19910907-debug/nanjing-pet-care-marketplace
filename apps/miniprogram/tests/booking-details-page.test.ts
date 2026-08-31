import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
async function setup() {
  let page: any;
  const api = {
    getCatalog: vi.fn(async () => ({ services: { CAT_FEEDING: { enabled: true, basePriceFen: 3200 }, DOG_WALKING: { enabled: true, basePriceFen: 3700 } }, openDistricts: ['JIANYE'], announcement: '' })),
    listPets: vi.fn(async () => []), listAddresses: vi.fn(async () => []),
    createPet: vi.fn(async (input: any) => ({ id: 'pet-1', name: input.name, species: input.species })),
    createAddress: vi.fn(async (input: any) => ({ id: 'address-1', city: input.city, district: input.district, serviceZone: input.serviceZone, detail: input.detail, label: `${input.district} · ${input.detail}` })),
    quote: vi.fn(async (_input: any) => ({ totalFen: 3200, baseFen: 3200, durationFen: 0, distanceFen: 0, extraPetFen: 0, holidayFen: 0, currency: 'CNY' })),
    createOrder: vi.fn(async (_input: any, _key: string) => ({ id: 'order-1' })),
  };
  const access = { load: vi.fn(async () => ({ userId: 'owner-1', role: 'OWNER', displayName: '小橘', expiresAt: '2099-01-01T00:00:00Z' })) };
  vi.stubGlobal('getApp', () => ({ globalData: { api, access } }));
  vi.stubGlobal('wx', { showToast: vi.fn(), navigateTo: vi.fn() });
  vi.stubGlobal('Page', (definition: any) => { page = { ...definition, data: structuredClone(definition.data), setData: vi.fn(function (this: any, value: unknown) { Object.assign(this.data, value); }) }; });
  await import('../pages/owner/order-create/index.js');
  await page.onLoad({});
  return { page, api };
}
const input = (value: string) => ({ detail: { value } });
async function ready(page: any) {
  page.changePetName(input('团子')); await page.savePet();
  page.changeAddressDetail(input('某小区1栋101')); await page.saveAddress();
  page.changeVisitDate(input('2099-09-01')); page.changeVisitTime(input('10:00'));
}

it('supports empty-owner first booking without a website detour', async () => {
  const { page, api } = await setup();
  expect(page.data.petMode).toBe('NEW'); expect(page.data.addressMode).toBe('NEW');
  await ready(page);
  expect(page.data.petMode).toBe('EXISTING'); expect(page.data.addressMode).toBe('EXISTING');
  expect(page.data.pets[page.data.petIndex].name).toBe('团子');
  expect(page.data.addresses[page.data.addressIndex].detail).toBe('某小区1栋101');
  await page.refreshQuote(); await page.submit();
  expect(api.createOrder).toHaveBeenCalledWith(expect.objectContaining({ petIds: ['pet-1'], addressId: 'address-1',
    startsAt: '2099-09-01T10:00:00+08:00', serviceType: 'CAT_FEEDING' }), expect.any(String));
  expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/owner/order-detail/index?id=order-1' });
});

it.each(['pet', 'address'] as const)('retries an uncertain %s save with the same frozen payload and key', async (kind) => {
  const { page, api } = await setup();
  const method = kind === 'pet' ? 'savePet' : 'saveAddress';
  const change = kind === 'pet' ? 'changePetName' : 'changeAddressDetail';
  const create = kind === 'pet' ? api.createPet : api.createAddress;
  page[change](input('原始资料'));
  create.mockRejectedValueOnce(new Error('NETWORK_UNAVAILABLE'));
  await page[method]();
  expect(page.data.detailError).not.toBe('');
  page[change](input('尝试修改'));
  await page[method]();
  expect(create.mock.calls[1]![0]).toEqual(create.mock.calls[0]![0]);
  expect(create.mock.calls[0]![0].clientRequestId).toMatch(/^[A-Za-z0-9_-]{1,100}$/);
});

it.each(['pet', 'address'] as const)('blocks duplicate %s saves and suppresses completion after unloading', async (kind) => {
  const { page, api } = await setup();
  const method = kind === 'pet' ? 'savePet' : 'saveAddress';
  page[kind === 'pet' ? 'changePetName' : 'changeAddressDetail'](input('资料'));
  let finish!: (value: any) => void;
  (kind === 'pet' ? api.createPet : api.createAddress).mockImplementationOnce(() => new Promise<any>((resolve) => { finish = resolve; }));
  const first = page[method](); await page[method]();
  expect(kind === 'pet' ? api.createPet : api.createAddress).toHaveBeenCalledOnce();
  page.onUnload(); page.setData.mockClear(); finish({ id: 'saved' }); await first;
  expect(page.setData).not.toHaveBeenCalled(); expect(wx.showToast).not.toHaveBeenCalled();
});

it('retains saved pet when address saving fails and never recreates it while quoting', async () => {
  const { page, api } = await setup();
  page.changePetName(input('团子')); await page.savePet();
  page.changeAddressDetail(input('地址')); api.createAddress.mockRejectedValueOnce(new Error('NETWORK_UNAVAILABLE'));
  await page.saveAddress(); await page.saveAddress();
  page.changeVisitDate(input('2099-09-01')); page.changeVisitTime(input('10:00'));
  await page.refreshQuote(); await page.refreshQuote();
  expect(api.createPet).toHaveBeenCalledOnce();
  expect(api.createAddress).toHaveBeenCalledTimes(2);
});

it('invalidates a quoted selection when time or service changes', async () => {
  const { page, api } = await setup(); await ready(page); await page.refreshQuote();
  page.changeVisitTime(input('11:00')); expect(page.data.quote).toBeNull();
  await page.submit(); expect(api.createOrder).not.toHaveBeenCalled();
  await page.refreshQuote(); page.chooseService({ currentTarget: { dataset: { value: 'DOG_WALKING' } } });
  expect(page.data.quote).toBeNull(); expect(page.data.pets).toEqual([]); expect(page.data.petMode).toBe('NEW');
});

it('freezes quote inputs while a request is in flight and ignores duplicate quote clicks', async () => {
  const { page, api } = await setup(); await ready(page);
  let finish!: (value: any) => void;
  api.quote.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const first = page.refreshQuote(); await page.refreshQuote(); page.changeVisitTime(input('12:00'));
  expect(api.quote).toHaveBeenCalledOnce(); expect(page.data.visitTime).toBe('10:00');
  finish({ totalFen: 3200, baseFen: 3200, durationFen: 0, distanceFen: 0, extraPetFen: 0, holidayFen: 0, currency: 'CNY' }); await first;
  await page.submit(); expect(api.createOrder.mock.calls[0]![0].startsAt).toBe('2099-09-01T10:00:00+08:00');
});

it('keeps ambiguous order retry on the original quote snapshot and idempotency key', async () => {
  const { page, api } = await setup(); await ready(page); await page.refreshQuote();
  api.createOrder.mockRejectedValueOnce(new Error('NETWORK_UNAVAILABLE'));
  await page.submit(); page.changeVisitTime(input('12:00')); page.chooseService({ currentTarget: { dataset: { value: 'DOG_WALKING' } } });
  await page.refreshQuote(); await page.submit();
  expect(api.createOrder.mock.calls[1]).toEqual(api.createOrder.mock.calls[0]);
  expect(api.quote).toHaveBeenCalledOnce();
});

it('allows editing after a definitive validation rejection and retains the typed draft', async () => {
  const { page, api } = await setup(); page.changePetName(input('团子'));
  const { ApiError } = await import('../services/api.js');
  api.createPet.mockRejectedValueOnce(new ApiError(400, 'VALIDATION_ERROR'));
  await page.savePet(); page.changePetName(input('小白'));
  expect(page.data.newPetName).toBe('小白');
});

it('uses date/time pickers and has no raw ISO-format or coordinate input', () => {
  const template = readFileSync('pages/owner/order-create/index.wxml', 'utf8');
  expect(template).toContain('mode="date"'); expect(template).toContain('mode="time"');
  expect(template).not.toContain('2026-09-01T10:00:00');
  expect(template).toContain('bindtap="savePet"'); expect(template).toContain('bindtap="saveAddress"');
});
