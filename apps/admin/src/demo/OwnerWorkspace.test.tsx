// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OwnerWorkspace } from './OwnerWorkspace.js';
import { createInitialState } from './workflow.js';

describe('OwnerWorkspace', () => {
  afterEach(cleanup);

  it('collects a booking in three short steps', async () => {
    const user = userEvent.setup();
    const create = vi.fn(() => true);
    render(<OwnerWorkspace
      state={createInitialState()}
      consumePrefill={vi.fn()}
      create={create}
      confirm={vi.fn()}
    />);

    expect(screen.getByRole('heading', { name: '服务与时间' })).toBeTruthy();
    expect(screen.queryByLabelText('宠物昵称')).toBeNull();
    expect(screen.queryByLabelText('详细地址')).toBeNull();

    await user.selectOptions(screen.getByLabelText('服务类型'), 'DOG_WALKING');
    await user.type(screen.getByLabelText('上门时间'), '2026-09-01T19:00');
    await user.click(screen.getByRole('button', { name: '下一步：填写上门信息' }));

    expect(screen.getByRole('heading', { name: '上门信息' })).toBeTruthy();
    expect(screen.queryByLabelText('服务备注')).toBeNull();
    await user.type(screen.getByLabelText('宠物昵称'), '团子');
    await user.selectOptions(screen.getByLabelText('服务区域'), '秦淮区');
    await user.type(screen.getByLabelText('详细地址'), '测试路 1 号');
    await user.click(screen.getByRole('button', { name: '补充服务备注（选填）' }));
    await user.type(screen.getByLabelText('服务备注'), '出门前检查牵引绳');
    await user.click(screen.getByRole('button', { name: '下一步：确认预约' }));

    expect(screen.getByRole('heading', { name: '确认预约' })).toBeTruthy();
    expect(screen.getByText('团子')).toBeTruthy();
    expect(screen.getByText('秦淮区 · 测试路 1 号')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '提交订单' }));

    expect(create).toHaveBeenCalledWith({
      serviceType: 'DOG_WALKING',
      petName: '团子',
      district: '秦淮区',
      address: '测试路 1 号',
      scheduledAt: '2026-09-01T19:00',
      notes: '出门前检查牵引绳',
    });
    expect(screen.getByRole('heading', { name: '演示预约已提交' })).toBeTruthy();
    expect(screen.getByText('仅保存在当前浏览器，不会形成真实订单或费用。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '提交订单' })).toBeNull();
    expect(screen.getByRole('link', { name: '查看我的订单' }).getAttribute('href')).toBe('#demo-owner-orders');
    await user.click(screen.getByRole('button', { name: '再预约一次' }));
    expect((screen.getByLabelText('上门时间') as HTMLInputElement).value).toBe('');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('keeps the complete draft on failure and starts a new form from an incoming service', async () => {
    const user = userEvent.setup();
    const props = { state: createInitialState(), consumePrefill: vi.fn(), create: vi.fn(() => false), confirm: vi.fn() };
    const view = render(<OwnerWorkspace {...props}/>);
    await user.type(screen.getByLabelText('上门时间'), '2026-09-01T19:00');
    await user.click(screen.getByRole('button', { name: '下一步：填写上门信息' }));
    await user.type(screen.getByLabelText('宠物昵称'), '团子');
    await user.type(screen.getByLabelText('详细地址'), '测试路');
    await user.click(screen.getByRole('button', { name: '下一步：确认预约' }));
    await user.click(screen.getByRole('button', { name: '提交订单' }));
    expect(screen.queryByRole('heading', { name: '演示预约已提交' })).toBeNull();
    expect(screen.getByText('团子')).toBeTruthy();
    expect(screen.getByRole('button', { name: '提交订单' })).toBeTruthy();
    view.rerender(<OwnerWorkspace {...props} prefill={{ serviceType: 'DOG_WALKING', district: '鼓楼区', requestKey: 1 }}/>);
    expect((screen.getByLabelText('服务类型') as HTMLSelectElement).value).toBe('DOG_WALKING');
    expect((screen.getByLabelText('上门时间') as HTMLInputElement).value).toBe('');
  });
});
