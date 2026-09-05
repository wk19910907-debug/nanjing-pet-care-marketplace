// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PilotApi } from './api.js';
import { StaffAccountPanel } from './StaffAccountPanel.js';

const staff = { userId: '11111111-1111-4111-8111-111111111111', username: 'provider.one', displayName: '小周', role: 'PROVIDER' as const, mustChangePassword: true, disabledAt: null, createdAt: '2026-09-01T00:00:00.000Z' };

function fakeApi(overrides: Partial<PilotApi> = {}): PilotApi {
  return { listStaffAccounts: vi.fn().mockResolvedValue([staff]), createStaffAccount: vi.fn().mockResolvedValue(staff), updateStaffAccount: vi.fn().mockResolvedValue(staff), resetStaffPassword: vi.fn().mockResolvedValue(undefined), ...overrides } as PilotApi;
}

describe('StaffAccountPanel', () => {
  afterEach(cleanup);

  it('lists provider accounts and creates only provider accounts with a temporary password revealed once', async () => {
    const api = fakeApi();
    const user = userEvent.setup();
    render(<StaffAccountPanel api={api} onError={() => '操作失败'}/>);
    expect(await screen.findByRole('button', { name: '停用 provider.one' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /管理员/ })).toBeNull();
    await user.type(screen.getByLabelText('员工用户名'), 'provider.two');
    await user.type(screen.getByLabelText('员工展示名称'), '小吴');
    await user.click(screen.getByRole('button', { name: '创建服务人员账号' }));
    expect(api.createStaffAccount).toHaveBeenCalledWith(expect.objectContaining({ username: 'provider.two', displayName: '小吴' }));
    const disclosure = await screen.findByRole('status');
    expect(disclosure.textContent).toContain('临时密码（仅显示一次）');
    await user.click(within(disclosure).getByRole('button', { name: '我已安全记录，关闭' }));
    expect(screen.queryByText('临时密码（仅显示一次）')).toBeNull();
  });

  it('requires scoped confirmation and blocks duplicate disable or reset requests', async () => {
    let release!: () => void;
    const updateStaffAccount = vi.fn().mockImplementation(() => new Promise((resolve) => { release = () => resolve(staff); }));
    const api = fakeApi({ updateStaffAccount });
    const user = userEvent.setup();
    render(<StaffAccountPanel api={api} onError={() => '操作失败'}/>);
    await screen.findByRole('button', { name: '停用 provider.one' });
    await user.click(screen.getByRole('button', { name: '停用 provider.one' }));
    const confirm = screen.getByRole('group', { name: '确认停用 provider.one' });
    const button = within(confirm).getByRole('button', { name: '确认停用' });
    await user.click(button);
    await user.click(button);
    expect(updateStaffAccount).toHaveBeenCalledTimes(1);
    expect(updateStaffAccount).toHaveBeenCalledWith(staff.userId, { disabled: true });
    release();
  });

  it('propagates protected API errors without retaining a reset password after dismissal', async () => {
    const api = fakeApi({ resetStaffPassword: vi.fn().mockRejectedValue(new Error('forbidden')) });
    const user = userEvent.setup();
    render(<StaffAccountPanel api={api} onError={() => '你没有权限执行此操作'}/>);
    await screen.findByRole('button', { name: '停用 provider.one' });
    await user.click(screen.getByRole('button', { name: '重置 provider.one 临时密码' }));
    await user.click(within(screen.getByRole('group', { name: '确认重置 provider.one 临时密码' })).getByRole('button', { name: '确认重置临时密码' }));
    expect((await screen.findByRole('alert')).textContent).toContain('你没有权限执行此操作');
    expect(screen.queryByText('临时密码（仅显示一次）')).toBeNull();
  });
});
