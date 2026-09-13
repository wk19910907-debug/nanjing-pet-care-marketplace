// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DemoApp } from './DemoApp.js';
import { userEvent } from '@testing-library/user-event';

describe('DemoApp public framing', () => {
  it('clears the receipt and starts an empty form when demo data is explicitly cleared', async () => {
    render(<DemoApp/>);
    const form = within(document.querySelector('form')!);
    fireEvent.change(form.getByLabelText('上门时间'), { target: { value: '2026-09-01T19:00' } });
    await userEvent.click(form.getByRole('button', { name: '下一步：填写上门信息' }));
    fireEvent.change(form.getByLabelText('宠物昵称'), { target: { value: '测试宠物' } });
    await userEvent.click(form.getByRole('button', { name: '下一步：确认预约' }));
    await userEvent.click(form.getByRole('button', { name: '提交订单' }));
    expect(screen.getByRole('heading', { name: '演示预约已提交' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '清空演示数据' }));
    expect(screen.queryByRole('heading', { name: '演示预约已提交' })).toBeNull();
    expect((screen.getByLabelText('上门时间') as HTMLInputElement).value).toBe('');
  });
  it('prefills the newly chosen dog then cat service and opens owner orders from another role', async () => {
    render(<DemoApp/>);
    await userEvent.click(screen.getByRole('button', { name: '预约上门遛狗' }));
    expect((within(document.querySelector('form')!).getByLabelText('服务类型') as HTMLSelectElement).value).toBe('DOG_WALKING');
    await userEvent.click(screen.getByRole('button', { name: '预约上门喂猫' }));
    expect((within(document.querySelector('form')!).getByLabelText('服务类型') as HTMLSelectElement).value).toBe('CAT_FEEDING');
    await userEvent.click(screen.getByRole('button', { name: '平台运营' }));
    await userEvent.click(screen.getAllByRole('button', { name: '我的订单' })[0]!);
    expect(screen.getByRole('heading', { name: '我的订单' }).id).toBe('demo-owner-orders');
  });
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('keeps the official landing formal and labels only the workflow as a demo', () => {
    window.history.replaceState({}, '', '/?fixture=service-loop');
    render(<DemoApp/>);

    expect(screen.queryByText('安全体验版')).toBeNull();
    expect(screen.getByRole('heading', { name: '平台功能演示' })).toBeTruthy();
    expect(screen.getByText('演示数据仅保存在当前浏览器，不会形成真实订单。')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: '功能演示角色' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '清空演示数据' })).toBeTruthy();
    expect(document.querySelectorAll('main main')).toHaveLength(0);
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
    expect(screen.getByText(/请勿填写门锁密码等敏感信息/)).toBeTruthy();
  });
});
