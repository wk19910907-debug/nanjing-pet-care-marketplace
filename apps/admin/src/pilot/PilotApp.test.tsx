// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PilotApi } from './api.js';
import { PilotApiError } from './api.js';
import { PilotApp } from './PilotApp.js';

const adminSession = {
  userId: 'admin-1', role: 'ADMIN' as const, displayName: '试点运营',
  expiresAt: '2026-09-03T10:00:00.000Z',
};

function fakeApi(overrides: Partial<PilotApi> = {}): PilotApi {
  return {
    getSession: vi.fn().mockResolvedValue(adminSession),
    createSession: vi.fn().mockResolvedValue({ expiresAt: adminSession.expiresAt }),
    updateProfile: vi.fn().mockResolvedValue({
      id: 'admin-1', role: 'ADMIN', displayName: '试点运营',
    }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    createInvite: vi.fn().mockResolvedValue({
      id: 'invite-new', role: 'OWNER', code: 'owner-code-once',
      expiresAt: '2026-08-28T10:00:00.000Z', createdAt: '2026-08-27T10:00:00.000Z',
    }),
    listInvites: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('PilotApp', () => {
  afterEach(cleanup);

  it('shows invitation-only login after a 401 with no registration or contact fields', async () => {
    const api = fakeApi({
      getSession: vi.fn().mockRejectedValue(new PilotApiError(401, 'UNAUTHENTICATED')),
    });

    render(<PilotApp api={api}/>);

    expect(await screen.findByRole('heading', { name: '邀请码登录' })).toBeTruthy();
    expect(screen.getByLabelText('邀请码')).toBeTruthy();
    expect(screen.getByRole('button', { name: '进入试运营' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/注册|找回密码|手机号|微信号|邮箱/);
  });

  it('redeems the controlled input and then requires a nickname before any workspace', async () => {
    const getSession = vi.fn()
      .mockRejectedValueOnce(new PilotApiError(401, 'UNAUTHENTICATED'))
      .mockResolvedValueOnce({ ...adminSession, displayName: null });
    const api = fakeApi({ getSession });
    const user = userEvent.setup();
    render(<PilotApp api={api}/>);

    await user.type(await screen.findByLabelText('邀请码'), 'single-use-code');
    await user.click(screen.getByRole('button', { name: '进入试运营' }));

    expect(api.createSession).toHaveBeenCalledWith('single-use-code');
    expect(await screen.findByRole('heading', { name: '设置展示昵称' })).toBeTruthy();
    expect(screen.queryByText('邀请码管理')).toBeNull();
    expect(screen.getByText('昵称不是实名，也不用于登录或线下身份核验。')).toBeTruthy();
  });

  it('updates a nickname and opens only the server-selected owner workspace', async () => {
    const ownerWithoutName = { ...adminSession, userId: 'owner-1', role: 'OWNER' as const, displayName: null };
    const api = fakeApi({
      getSession: vi.fn()
        .mockResolvedValueOnce(ownerWithoutName)
        .mockResolvedValueOnce({ ...ownerWithoutName, displayName: '秦淮宠主' }),
      updateProfile: vi.fn().mockResolvedValue({
        id: 'owner-1', role: 'OWNER', displayName: '秦淮宠主',
      }),
    });
    const user = userEvent.setup();
    render(<PilotApp api={api}/>);

    await user.type(await screen.findByLabelText('展示昵称'), '秦淮宠主');
    await user.click(screen.getByRole('button', { name: '保存昵称' }));

    expect(api.updateProfile).toHaveBeenCalledWith('秦淮宠主');
    expect(await screen.findByRole('heading', { name: '宠主工作区' })).toBeTruthy();
    expect(screen.queryByText('邀请码管理')).toBeNull();
    expect(screen.queryByRole('combobox', { name: /角色/ })).toBeNull();
  });

  it('allows only admins to create/list invites and clears the one-time code on refresh', async () => {
    const existing = {
      id: 'invite-old', role: 'PROVIDER' as const,
      expiresAt: '2026-08-28T09:00:00.000Z', consumedAt: null,
      createdAt: '2026-08-27T09:00:00.000Z',
    };
    const listInvites = vi.fn().mockResolvedValue([existing]);
    const api = fakeApi({ listInvites });
    const user = userEvent.setup();
    render(<PilotApp api={api}/>);

    expect(await screen.findByRole('heading', { name: '邀请码管理' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '宠主' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '服务人员' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: '管理员' })).toBeNull();
    await user.selectOptions(screen.getByLabelText('邀请角色'), 'PROVIDER');
    await user.click(screen.getByRole('button', { name: '创建一次性邀请码' }));

    expect(api.createInvite).toHaveBeenCalledWith('PROVIDER');
    expect(await screen.findByText('owner-code-once')).toBeTruthy();
    expect(screen.getByText('邀请码仅显示一次，请通过受控线下渠道交付。')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '刷新邀请记录' }));

    await waitFor(() => expect(listInvites).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('owner-code-once')).toBeNull();
    expect(screen.getByText('服务人员 · 未使用')).toBeTruthy();
  });

  it('fails closed on 503, retries, and logs out the current cookie session', async () => {
    const getSession = vi.fn()
      .mockRejectedValueOnce(new PilotApiError(503, 'SERVICE_UNAVAILABLE'))
      .mockResolvedValueOnce(adminSession)
      .mockRejectedValueOnce(new PilotApiError(401, 'UNAUTHENTICATED'));
    const api = fakeApi({ getSession });
    render(<PilotApp api={api}/>);

    expect((await screen.findByRole('alert')).textContent).toContain('服务暂时不可用，请稍后重试');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('heading', { name: '邀请码管理' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));

    await waitFor(() => expect(api.deleteSession).toHaveBeenCalledOnce());
    expect(await screen.findByRole('heading', { name: '邀请码登录' })).toBeTruthy();
  });

  it('shows fixed Chinese copy for unexpected client errors', async () => {
    const api = fakeApi({
      getSession: vi.fn().mockRejectedValue(new Error('Failed to fetch C:\\internal\\secret')),
    });
    render(<PilotApp api={api}/>);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('服务暂时不可用，请稍后重试');
    expect(alert.textContent).not.toContain('internal');
    expect(alert.textContent).not.toContain('Failed to fetch');
  });

  it('fails closed when the server session is already expired', async () => {
    const api = fakeApi({
      getSession: vi.fn().mockResolvedValue({
        ...adminSession, expiresAt: '2020-01-01T00:00:00.000Z',
      }),
    });
    render(<PilotApp api={api}/>);

    expect(await screen.findByRole('heading', { name: '邀请码登录' })).toBeTruthy();
    expect(screen.queryByText('邀请码管理')).toBeNull();
    expect(api.listInvites).not.toHaveBeenCalled();
  });

  it('clears protected invitation data when a child request returns 401', async () => {
    const existing = {
      id: 'invite-old', role: 'OWNER' as const,
      expiresAt: '2026-09-01T10:00:00.000Z', consumedAt: null,
      createdAt: '2026-08-27T09:00:00.000Z',
    };
    const listInvites = vi.fn()
      .mockResolvedValueOnce([existing])
      .mockRejectedValueOnce(new PilotApiError(401, 'UNAUTHENTICATED'));
    const api = fakeApi({ listInvites });
    const user = userEvent.setup();
    render(<PilotApp api={api}/>);

    expect(await screen.findByText('宠主 · 未使用')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '刷新邀请记录' }));

    expect(await screen.findByRole('heading', { name: '邀请码登录' })).toBeTruthy();
    expect(screen.queryByText('宠主 · 未使用')).toBeNull();
    expect(screen.queryByText('邀请码管理')).toBeNull();
  });
});
