// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicLanding } from './PublicLanding.js';

const catalog = {
  services: {
    CAT_FEEDING: { enabled: true, basePriceFen: 3_200 },
    DOG_WALKING: { enabled: true, basePriceFen: 3_700 },
  },
  openDistricts: ['JIANYE', 'GULOU', 'XUANWU', 'QINHUAI'] as Array<'JIANYE' | 'GULOU' | 'XUANWU' | 'QINHUAI'>,
  announcement: '',
};

describe('PublicLanding', () => {
  afterEach(cleanup);

  it('leads with a truthful booking-first public experience', async () => {
    const onStartOrder = vi.fn();
    render(<PublicLanding
      catalog={catalog}
      onStartOrder={onStartOrder}
      onQuoteStartOrder={vi.fn()}
      quoteSelection={{ serviceType: 'CAT_FEEDING', district: '建邺区' }}
      onQuoteChange={vi.fn()}
    ><div>角色入口</div></PublicLanding>);

    expect(screen.getByRole('heading', { name: '出门放心，宠物在家也被认真照顾' })).toBeTruthy();
    expect(screen.getByText('¥32 起')).toBeTruthy();
    expect(screen.getByText('¥37 起')).toBeTruthy();
    for (const label of ['身份资料审核', '平台统一匹配', '订单状态可查', '服务过程留痕']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(document.body.textContent).not.toMatch(/安全体验版|演示人员|不会上传到远端服务器|体验报价/);

    await userEvent.click(screen.getAllByRole('button', { name: '立即预约' })[0]!);
    expect(onStartOrder).toHaveBeenCalledOnce();
  });

  it('uses live availability, price, districts, and announcement', () => {
    render(<PublicLanding
      catalog={{
        ...catalog,
        services: {
          CAT_FEEDING: { enabled: true, basePriceFen: 3_500 },
          DOG_WALKING: { enabled: false, basePriceFen: 3_700 },
        },
        openDistricts: ['GULOU'],
        announcement: '周末正常接单',
      }}
      onStartOrder={vi.fn()}
      onQuoteStartOrder={vi.fn()}
      quoteSelection={{ serviceType: 'CAT_FEEDING', district: '建邺区' }}
      onQuoteChange={vi.fn()}
    ><div>登录入口</div></PublicLanding>);
    expect(screen.getByText('周末正常接单')).toBeTruthy();
    expect(screen.getAllByText('¥35 起').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '预约遛狗' })).toBeNull();
    expect(screen.getByRole('option', { name: '鼓楼区' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: '建邺区' })).toBeNull();
  });
});
