// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PilotApi } from './api.js';
import { createPilotApi, PilotApiError } from './api.js';
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
    listPets: vi.fn().mockResolvedValue([]),
    createPet: vi.fn(),
    listAddresses: vi.fn().mockResolvedValue([]),
    createAddress: vi.fn(),
    getQuote: vi.fn(),
    createOrder: vi.fn(),
    listOrders: vi.fn().mockResolvedValue([]),
    confirmOrder: vi.fn(),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('PilotApp', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

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
    expect(await screen.findByRole('heading', { name: '宠物档案' })).toBeTruthy();
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

  it('never renders a stale one-time code when an overlapping refresh fails', async () => {
    const create = deferred<Awaited<ReturnType<PilotApi['createInvite']>>>();
    const refresh = deferred<Awaited<ReturnType<PilotApi['listInvites']>>>();
    const listInvites = vi.fn()
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => refresh.promise);
    const api = fakeApi({
      createInvite: vi.fn().mockImplementation(() => create.promise),
      listInvites,
    });
    const user = userEvent.setup();
    render(<PilotApp api={api}/>);

    expect(await screen.findByRole('heading', { name: '邀请码管理' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '创建一次性邀请码' }));
    await user.click(screen.getByRole('button', { name: '刷新邀请记录' }));
    await act(async () => {
      create.resolve({
        id: 'invite-race', role: 'OWNER', code: 'must-never-render',
        expiresAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-08-28T00:00:00.000Z',
      });
      await Promise.resolve();
    });
    await act(async () => {
      refresh.reject(new PilotApiError(503, 'SERVICE_UNAVAILABLE'));
      await Promise.resolve();
    });

    expect(screen.queryByText('must-never-render')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('服务暂时不可用，请稍后重试');
    expect(api.createInvite).toHaveBeenCalledTimes(1);
  });

  it('synchronously rejects duplicate invitation form submissions', async () => {
    const create = deferred<Awaited<ReturnType<PilotApi['createInvite']>>>();
    const api = fakeApi({
      createInvite: vi.fn().mockImplementation(() => create.promise),
    });
    render(<PilotApp api={api}/>);
    expect(await screen.findByRole('heading', { name: '邀请码管理' })).toBeTruthy();
    const form = document.querySelector<HTMLFormElement>('.pilot-invite-form')!;

    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });

    expect(api.createInvite).toHaveBeenCalledTimes(1);
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

  it('unloads the admin UI when a stale create returns 401 after refresh begins', async () => {
    const create = deferred<Awaited<ReturnType<PilotApi['createInvite']>>>();
    const refresh = deferred<Awaited<ReturnType<PilotApi['listInvites']>>>();
    const api = fakeApi({
      createInvite: vi.fn().mockImplementation(() => create.promise),
      listInvites: vi.fn()
        .mockResolvedValueOnce([])
        .mockImplementationOnce(() => refresh.promise),
    });
    const user = userEvent.setup();
    render(<PilotApp api={api}/>);

    expect(await screen.findByRole('heading', { name: '邀请码管理' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '创建一次性邀请码' }));
    await user.click(screen.getByRole('button', { name: '刷新邀请记录' }));
    await act(async () => {
      create.reject(new PilotApiError(401, 'UNAUTHENTICATED'));
      await Promise.resolve();
    });

    expect(await screen.findByRole('heading', { name: '邀请码登录' })).toBeTruthy();
    expect(screen.queryByText('邀请码管理')).toBeNull();
    expect(screen.queryByText('must-never-render')).toBeNull();
  });

  it('never opens a protected workspace for an invalid runtime display name', async () => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      userId: 'admin-1', role: 'ADMIN', displayName: ' 未修剪昵称',
      expiresAt: '2026-09-03T10:00:00.000Z',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    render(<PilotApp api={api}/>);

    expect((await screen.findByRole('alert')).textContent).toContain('服务暂时不可用，请稍后重试');
    expect(screen.queryByText('邀请码管理')).toBeNull();
    expect(screen.queryByText('平台管理员工作区')).toBeNull();
  });

  it('does not clear a long session when the capped timer fires before the real expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
    const api = fakeApi({
      getSession: vi.fn().mockResolvedValue({
        ...adminSession, expiresAt: '2026-08-31T00:00:00.000Z',
      }),
    });

    render(<PilotApp api={api}/>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('heading', { name: '邀请码管理' })).toBeTruthy();

    act(() => { vi.advanceTimersByTime(2_147_483_647); });
    expect(screen.getByRole('heading', { name: '邀请码管理' })).toBeTruthy();

    act(() => { vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1_000 - 2_147_483_647); });
    expect(screen.getByRole('heading', { name: '邀请码登录' })).toBeTruthy();
  });
});
