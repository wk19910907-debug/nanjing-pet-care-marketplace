// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OwnerHome } from './OwnerHome.js';

const catalog = {
  services: {
    CAT_FEEDING: { enabled: true, basePriceFen: 3_200 },
    DOG_WALKING: { enabled: true, basePriceFen: 3_700 },
  },
  openDistricts: ['JIANYE', 'GULOU'] as Array<'JIANYE' | 'GULOU'>,
  announcement: '',
};

describe('OwnerHome', () => {
  afterEach(cleanup);

  it('explains the two services and four truthful safeguards without rendering a form', async () => {
    const onBook = vi.fn();
    render(<OwnerHome catalog={catalog} displayName="建邺宠主" orders={[]} loading={false} onBook={onBook} onRefresh={vi.fn()}/>);

    expect(screen.getByText('今日可预约')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '今天需要照顾谁？' })).toBeTruthy();
    expect(screen.getByText('¥32 起')).toBeTruthy();
    expect(screen.getByText('¥37 起')).toBeTruthy();
    const safeguards = screen.getByRole('region', { name: '每次上门都有交代' });
    expect(within(safeguards).getAllByText(/身份审核|平台匹配|服务留痕/)).toHaveLength(3);
    expect(document.querySelector('form')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.body.textContent).not.toMatch(/本地试运营|宠主工作区|刷新全部/);

    await userEvent.click(screen.getByRole('button', { name: '预约上门遛狗' }));
    expect(onBook).toHaveBeenCalledWith('DOG_WALKING');
  });

  it('summarizes the newest active order with pet, status, time, and price', () => {
    render(<OwnerHome catalog={catalog} displayName="建邺宠主" loading={false} onBook={vi.fn()} onRefresh={vi.fn()} orders={[{
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
    render(<OwnerHome catalog={catalog} displayName="建邺宠主" orders={[]} loading={false} onBook={vi.fn()} onRefresh={vi.fn()}/>);
    expect(screen.getByText('还没有进行中的服务')).toBeTruthy();
    expect(screen.getByRole('button', { name: '立即预约' })).toBeTruthy();
  });

  it('renders the live announcement and only currently enabled services at their live prices', () => {
    render(<OwnerHome catalog={{
      ...catalog,
      services: {
        CAT_FEEDING: { enabled: true, basePriceFen: 3_500 },
        DOG_WALKING: { enabled: false, basePriceFen: 3_700 },
      },
      announcement: '周末正常接单',
    }} displayName="建邺宠主" orders={[]} loading={false} onBook={vi.fn()} onRefresh={vi.fn()}/>);
    expect(screen.getByText('周末正常接单')).toBeTruthy();
    expect(screen.getByText('¥35 起')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '预约上门遛狗' })).toBeNull();
  });
});
