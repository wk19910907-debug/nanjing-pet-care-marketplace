// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OwnerHome } from './OwnerHome.js';

describe('OwnerHome', () => {
  afterEach(cleanup);

  it('explains the two services and four truthful safeguards without rendering a form', async () => {
    const onBook = vi.fn();
    render(<OwnerHome displayName="建邺宠主" orders={[]} loading={false} onBook={onBook} onRefresh={vi.fn()}/>);

    expect(screen.getByRole('heading', { name: '放心把它交给我们' })).toBeTruthy();
    expect(screen.getByText('¥32 起')).toBeTruthy();
    expect(screen.getByText('¥37 起')).toBeTruthy();
    const safeguards = screen.getByRole('region', { name: '每次上门都有交代' });
    expect(within(safeguards).getAllByText(/人员认证|平台匹配|服务留痕|异常协助/)).toHaveLength(4);
    expect(document.querySelector('form')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '预约上门遛狗' }));
    expect(onBook).toHaveBeenCalledWith('DOG_WALKING');
  });

  it('summarizes the newest active order with pet, status, time, and price', () => {
    render(<OwnerHome displayName="建邺宠主" loading={false} onBook={vi.fn()} onRefresh={vi.fn()} orders={[{
      id: '44444444-4444-4444-8444-444444444444',
      serviceType: 'CAT_FEEDING',
      status: 'PENDING_DISPATCH',
      startsAt: '2026-09-10T02:00:00.000Z',
      durationMinutes: 30,
      totalFen: 3900,
      currency: 'CNY',
      city: '南京市',
      district: '建邺区',
      serviceZone: '建邺区',
      petNames: ['团子'],
    }]}/>);

    expect(screen.getByText('团子 · 上门喂猫')).toBeTruthy();
    expect(screen.getByText('等待平台匹配服务人员')).toBeTruthy();
    expect(screen.getByText('¥39.00')).toBeTruthy();
    expect(screen.getByRole('link', { name: '查看订单进度' }).getAttribute('href')).toBe('#owner-orders');
  });

  it('shows a clear empty-order action without pretending an order exists', () => {
    render(<OwnerHome displayName="建邺宠主" orders={[]} loading={false} onBook={vi.fn()} onRefresh={vi.fn()}/>);
    expect(screen.getByText('还没有进行中的服务')).toBeTruthy();
    expect(screen.getByRole('button', { name: '立即预约' })).toBeTruthy();
  });
});
