// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicLanding } from './PublicLanding.js';

describe('PublicLanding', () => {
  afterEach(cleanup);

  it('leads with a truthful booking-first public experience', async () => {
    const onStartOrder = vi.fn();
    render(<PublicLanding
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
});
