// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PilotApi } from './api.js';
import { AdminPilotWorkspace } from './AdminPilotWorkspace.js';

const pendingFee = {
  id: '11111111-1111-4111-8111-111111111111', serviceType: 'CAT_FEEDING' as const,
  status: 'PENDING_PAYMENT' as const, startsAt: '2026-09-10T02:00:00.000Z',
  durationMinutes: 30, totalFen: 3900, currency: 'CNY' as const,
  city: '南京市', district: '建邺区', serviceZone: '建邺区', ownerDisplayName: '建邺团子家',
};
const pendingDispatch = { ...pendingFee, id: '22222222-2222-4222-8222-222222222222', status: 'PENDING_DISPATCH' as const };
const dispatchFailed = { ...pendingFee, id: '33333333-3333-4333-8333-333333333333', status: 'DISPATCH_FAILED' as const };

function fakeApi(overrides: Partial<PilotApi> = {}): PilotApi {
  return {
    listProviderReviewQueue: vi.fn().mockResolvedValue([{
      id: '44444444-4444-4444-8444-444444444444', displayName: '秦淮小周',
      reviewStatus: 'PENDING', serviceTypes: ['CAT_FEEDING'], serviceZone: '秦淮区', radiusKm: 5,
      catExperienceMonths: 18, dogExperienceMonths: 0, createdAt: '2026-08-28T02:00:00.000Z',
    }]),
    listAdminOrders: vi.fn().mockResolvedValue([pendingFee, pendingDispatch, dispatchFailed]),
    reviewProvider: vi.fn().mockResolvedValue(undefined),
    confirmManualFee: vi.fn().mockResolvedValue(undefined),
    startDispatch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as PilotApi;
}

describe('AdminPilotWorkspace', () => {
  afterEach(cleanup);

  it('shows approved and suspended roster rows and can suspend an approved provider', async () => {
    const reviewProvider = vi.fn().mockResolvedValue(undefined);
    const api = fakeApi({
      reviewProvider,
      listProviderReviewQueue: vi.fn().mockResolvedValue([
        { id: 'approved-1', displayName: '已批准小周', reviewStatus: 'APPROVED', serviceTypes: ['CAT_FEEDING'], catExperienceMonths: 12, dogExperienceMonths: 0, serviceZone: '秦淮区', radiusKm: 5, createdAt: '2026-08-28T00:00:00.000Z' },
        { id: 'suspended-1', displayName: '已暂停小吴', reviewStatus: 'SUSPENDED', serviceTypes: ['DOG_WALKING'], catExperienceMonths: 0, dogExperienceMonths: 12, serviceZone: '玄武区', radiusKm: 5, createdAt: '2026-08-28T00:00:00.000Z' },
      ]),
    });
    render(<AdminPilotWorkspace api={api} onError={() => '失败'}/>);
    await userEvent.click(await screen.findByRole('button', { name: '暂停已批准小周' }));
    await userEvent.click(screen.getByRole('button', { name: '确认暂停已批准小周' }));
    expect(reviewProvider).toHaveBeenCalledWith('approved-1', 'SUSPENDED');
    expect(screen.getByText('已暂停小吴')).toBeTruthy();
  });

  it('renders separate safe queues without exact addresses or payment claims', async () => {
    render(<AdminPilotWorkspace api={fakeApi()} onError={() => 'error'}/>);
    expect(await screen.findByRole('heading', { name: '平台工作区' })).toBeTruthy();
    for (const heading of ['服务人员审核', '待核对费用', '待派单', '派单异常', '全部订单进度']) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
    expect(screen.getByText('本系统未处理在线支付')).toBeTruthy();
    expect(document.body.textContent).toContain('南京市 · 建邺区 · 建邺区服务圈');
    expect(document.body.textContent).not.toMatch(/详细地址|门牌|手机号|微信|银行卡|已支付/);
  });

  it('requires target-scoped confirmations and reuses one fee key while blocking duplicates', async () => {
    let resolveFee!: () => void;
    const confirmManualFee = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { resolveFee = resolve; }));
    const reviewProvider = vi.fn().mockResolvedValue(undefined);
    const startDispatch = vi.fn().mockResolvedValue(undefined);
    const api = fakeApi({ confirmManualFee, reviewProvider, startDispatch });
    const user = userEvent.setup();
    render(<AdminPilotWorkspace api={api} onError={() => 'error'}/>);
    await screen.findByText('秦淮小周');

    await user.click(screen.getByRole('button', { name: '审核秦淮小周' }));
    const reviewConfirm = screen.getByRole('group', { name: '确认审核秦淮小周' });
    expect(reviewConfirm.textContent).toContain('秦淮小周');
    await user.click(within(reviewConfirm).getByRole('button', { name: '确认批准' }));
    expect(reviewProvider).toHaveBeenCalledWith('44444444-4444-4444-8444-444444444444', 'APPROVED');

    await user.click(screen.getByRole('button', { name: `核对订单 ${pendingFee.id} 费用` }));
    const feeConfirm = screen.getByRole('group', { name: `确认订单 ${pendingFee.id} 费用` });
    const confirmButton = within(feeConfirm).getByRole('button', { name: '确认记录费用已线下核对' });
    await user.click(confirmButton);
    await user.click(confirmButton);
    expect(confirmManualFee).toHaveBeenCalledTimes(1);
    const key = confirmManualFee.mock.calls[0]![1] as string;
    expect(key.length).toBeGreaterThanOrEqual(8);
    resolveFee();
    await waitFor(() => expect(api.listAdminOrders).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole('button', { name: `派单订单 ${pendingDispatch.id}` }));
    const dispatchConfirm = screen.getByRole('group', { name: `确认派单订单 ${pendingDispatch.id}` });
    await user.click(within(dispatchConfirm).getByRole('button', { name: '确认启动派单' }));
    expect(startDispatch).toHaveBeenCalledWith(pendingDispatch.id);
  });

  it('retries a lost fee response with the same logical idempotency key', async () => {
    const confirmManualFee = vi.fn()
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce(undefined);
    const api = fakeApi({ confirmManualFee });
    const user = userEvent.setup();
    render(<AdminPilotWorkspace api={api} onError={() => '请重试'}/>);
    await user.click(await screen.findByRole('button', { name: `核对订单 ${pendingFee.id} 费用` }));
    await user.click(screen.getByRole('button', { name: '确认记录费用已线下核对' }));
    expect((await screen.findByRole('alert')).textContent).toContain('请重试');
    await user.click(screen.getByRole('button', { name: '确认记录费用已线下核对' }));
    expect(confirmManualFee).toHaveBeenCalledTimes(2);
    expect(confirmManualFee.mock.calls[1]![1]).toBe(confirmManualFee.mock.calls[0]![1]);
  });
});
