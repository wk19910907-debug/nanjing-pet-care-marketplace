// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicLanding } from './PublicLanding.js';
import { readFileSync } from 'node:fs';

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

  it('offsets the home anchor below the sticky public header', () => {
    const css = readFileSync('src/demo/customer-web.css', 'utf8');
    expect(css).toContain('.customer-web #top { scroll-margin-top: 88px; }');
  });

  it('locks the customer website to one premium white commerce system', () => {
    const css = readFileSync('src/demo/customer-web.css', 'utf8').toLowerCase().replaceAll('\r\n', '\n');
    for (const token of [
      '--store-canvas: #f6f6f1', '--store-surface: #ffffff', '--store-ink: #17231d',
      '--store-brand: #1f4b3a', '--store-brand-deep: #143428', '--store-gold: #b79a63',
    ]) expect(css).toContain(token);
    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('min-height: 44px');
    expect(css).toContain('background: var(--store-brand-deep)');
    expect(css).toContain('.customer-web .store-hero-copy { order: 1;');
    expect(css).toContain('order: 2;\n    min-height: 0;\n    aspect-ratio: 16 / 10;');
    expect(css).not.toContain('color: var(--store-gold)');
    expect(css).not.toMatch(/font-size: (9|10|11)px/);
    expect(css).toMatch(/\.store-nav-links a \{[^}]*min-height: 44px/s);
    expect(css).toMatch(/\.store-footer nav a \{[^}]*min-height: 44px/s);
    expect(css).not.toMatch(/songti|stsong|georgia/);
    expect(css).not.toMatch(/#f47672|#b94f43|#463831|#4e3b33|#925044/);
  });

  it('offers orders access and keeps optional pricing collapsed before the booking workspace', async () => {
    const orders = vi.fn();
    render(<PublicLanding pricingSource="server" catalog={catalog} onStartOrder={vi.fn()} onViewOrders={orders} onQuoteStartOrder={vi.fn()} quoteSelection={{ serviceType: 'CAT_FEEDING', district: '建邺区' }} onQuoteChange={vi.fn()}><div data-testid="booking">预约入口</div></PublicLanding>);
    await userEvent.click(screen.getAllByRole('button', { name: '我的订单' })[0]!);
    expect(orders).toHaveBeenCalledOnce();
    const pricing = screen.getByText('查看区域与参考价格').closest('details')!;
    expect(pricing).not.toBeNull();
    expect(pricing.open).toBe(false);
    expect(screen.getByTestId('booking').compareDocumentPosition(screen.getByRole('heading', { name: '从提交需求到查看记录' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('uses the booking entry for orders when no signed-in orders callback exists', async () => {
    const start = vi.fn();
    render(<PublicLanding pricingSource="server" catalog={catalog} onStartOrder={start} onQuoteStartOrder={vi.fn()} quoteSelection={{ serviceType: 'CAT_FEEDING', district: '建邺区' }} onQuoteChange={vi.fn()}>{null}</PublicLanding>);
    await userEvent.click(screen.getAllByRole('button', { name: '我的订单' })[0]!);
    expect(start).toHaveBeenCalledOnce();
  });

  it('leads with a truthful premium commerce hierarchy', async () => {
    const onStartOrder = vi.fn();
    const onQuoteStartOrder = vi.fn();
    const onQuoteChange = vi.fn();
    const onViewOrders = vi.fn();
    render(<PublicLanding
      pricingSource="server"
      catalog={catalog}
      onStartOrder={onStartOrder}
      onViewOrders={onViewOrders}
      onQuoteStartOrder={onQuoteStartOrder}
      quoteSelection={{ serviceType: 'CAT_FEEDING', district: '建邺区' }}
      onQuoteChange={onQuoteChange}
    ><div>预约工作区</div></PublicLanding>);

    expect(screen.getByRole('heading', { name: '熟悉的家，安心的照护' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: '服务快捷入口' })).toBeTruthy();
    expect(screen.getByText('¥32 起')).toBeTruthy();
    expect(screen.getByText('¥37 起')).toBeTruthy();
    expect(screen.getByText('最终价格以确认预约时的服务器报价为准')).toBeTruthy();
    expect(screen.getByText('最终价格以预约确认页的服务器报价为准')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/自主选人|五星|服务\d+次|用户\d+人/);

    await userEvent.click(screen.getByRole('button', { name: '快捷预约上门喂猫' }));
    expect(onQuoteChange).toHaveBeenCalledWith({ serviceType: 'CAT_FEEDING', district: '建邺区' });
    expect(onQuoteStartOrder).toHaveBeenCalledWith({ serviceType: 'CAT_FEEDING', district: '建邺区' });
    await userEvent.click(screen.getAllByRole('button', { name: '我的订单' })[0]!);
    expect(onViewOrders).toHaveBeenCalledOnce();
  });

  it('uses live availability, price, districts, and announcement', () => {
    render(<PublicLanding
      pricingSource="server"
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
    expect(screen.queryByRole('button', { name: '预约上门遛狗' })).toBeNull();
    expect(screen.getByRole('option', { name: '鼓楼区' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: '建邺区' })).toBeNull();
  });
});
