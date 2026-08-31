import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it('loads authenticated provider tasks and never accepts unknown invitation IDs', async () => {
  let page: any;
  const api = { listProviderTasks: vi.fn(async () => [{ id: 'order-1', serviceType: 'DOG_WALKING',
    status: 'PENDING_SERVICE', district: '建邺区', startsAt: '2026-09-10T10:00:00Z' }]), acceptInvitation: vi.fn() };
  const access = { load: vi.fn(async () => ({ displayName: '小橘' })) }; const navigateTo = vi.fn();
  vi.stubGlobal('wx', { navigateTo });
  vi.stubGlobal('getApp', () => ({ globalData: { api, access } }));
  vi.stubGlobal('Page', (definition: any) => { page = { ...definition, data: structuredClone(definition.data),
    setData(value: unknown) { Object.assign(this.data, value); } }; });
  await import('../pages/provider/invitations/index.js');
  await page.onLoad();
  expect(access.load).toHaveBeenCalledWith('PROVIDER');
  expect(page.data.tasks[0].id).toBe('order-1');
  await page.accept({ currentTarget: { dataset: { id: 'not-returned' } } });
  expect(api.acceptInvitation).not.toHaveBeenCalled();
  page.openTask({ currentTarget: { dataset: { id: 'order-1' } } });
  expect(navigateTo).toHaveBeenCalledWith({ url: '/pages/provider/service/index?id=order-1' });
});

it('preserves a failed acceptance message when refresh leaves the invitation pending', async () => {
  let page: any;
  const api = { listProviderTasks: async () => [{ id: 'order-1', serviceType: 'CAT_FEEDING',
    invitation: { id: 'invite-1', status: 'PENDING', expiresAt: '2099-01-01T00:00:00Z' } }],
  acceptInvitation: async () => { throw new Error('conflict'); } };
  vi.stubGlobal('getApp', () => ({ globalData: { api, access: { load: async () => ({ displayName: '小橘' }) } } }));
  vi.stubGlobal('Page', (definition: any) => { page = { ...definition, data: structuredClone(definition.data),
    setData(value: unknown) { Object.assign(this.data, value); } }; });
  await import('../pages/provider/invitations/index.js');
  await page.onLoad(); await page.accept({ currentTarget: { dataset: { id: 'invite-1' } } });
  expect(page.data.error).not.toBe('');
});
