// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    createLocalSession: vi.fn().mockResolvedValue({ expiresAt: adminSession.expiresAt }),
    updateProfile: vi.fn().mockResolvedValue({
      id: 'admin-1', role: 'ADMIN', displayName: '试点运营',
    }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    createInvite: vi.fn(), listInvites: vi.fn().mockResolvedValue([]),
    listPets: vi.fn().mockResolvedValue([]), createPet: vi.fn(),
    listAddresses: vi.fn().mockResolvedValue([]), createAddress: vi.fn(),
    getQuote: vi.fn(), createOrder: vi.fn(), listOrders: vi.fn().mockResolvedValue([]),
    confirmOrder: vi.fn(), getEvidenceReadUrl: vi.fn(),
    listProviderReviewQueue: vi.fn().mockResolvedValue([]),
    listAdminOrders: vi.fn().mockResolvedValue([]), listProviderOrders: vi.fn().mockResolvedValue([]),
    reviewProvider: vi.fn(), confirmManualFee: vi.fn(), startDispatch: vi.fn(),
    applyProvider: vi.fn(), setProviderAvailability: vi.fn(), acceptInvitation: vi.fn(),
    getAssignedAddress: vi.fn(), checkIn: vi.fn(), issueEvidenceUpload: vi.fn(),
    uploadEvidence: vi.fn(), attachEvidence: vi.fn(), submitReport: vi.fn(),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe('PilotApp', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders exactly the three direct role-entry actions without invitation or contact fields', async () => {
    const api = fakeApi({
      getSession: vi.fn().mockRejectedValue(new PilotApiError(401, 'UNAUTHENTICATED')),
    });
    render(<PilotApp api={api}/>);

    expect(await screen.findByRole('button', { name: '以宠主身份进入' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '以服务人员身份进入' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '以平台管理员身份进入' })).toBeTruthy();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '以宠主身份进入', '以服务人员身份进入', '以平台管理员身份进入',
    ]);
    expect(screen.queryByLabelText('邀请码')).toBeNull();
    expect(screen.queryByText('邀请码管理')).toBeNull();
    expect(document.body.textContent).not.toMatch(/邀请码|注册|找回密码|手机号|微信号|邮箱|支付/);
  });

  it('groups the direct role-entry actions under a clear accessible label', async () => {
    const api = fakeApi({
      getSession: vi.fn().mockRejectedValue(new PilotApiError(401, 'UNAUTHENTICATED')),
    });
    render(<PilotApp api={api}/>);

    const group = await screen.findByRole('group', { name: '试运营身份入口' });
    expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '以宠主身份进入', '以服务人员身份进入', '以平台管理员身份进入',
    ]);
  });

  it.each([
    ['以宠主身份进入', 'OWNER', '宠主工作区'],
    ['以服务人员身份进入', 'PROVIDER', '服务人员工作区'],
    ['以平台管理员身份进入', 'ADMIN', '平台工作区'],
  ] as const)('maps %s to %s and opens %s', async (action, role, workspace) => {
    const sessions = {
      OWNER: { ...adminSession, userId: 'owner-1', role: 'OWNER' as const, displayName: '秦淮宠主' },
      PROVIDER: { ...adminSession, userId: 'provider-1', role: 'PROVIDER' as const, displayName: '秦淮小周' },
      ADMIN: adminSession,
    };
    const getSession = vi.fn()
      .mockRejectedValueOnce(new PilotApiError(401, 'UNAUTHENTICATED'))
      .mockResolvedValue(sessions[role]);
    const api = fakeApi({ getSession });
    const user = userEvent.setup();
    render(<PilotApp api={api}/>);

    await user.click(await screen.findByRole('button', { name: action }));
    expect(api.createLocalSession).toHaveBeenCalledWith(role);
    await screen.findByRole('heading', { name: workspace });
  });

  it('disables every entry action and makes one local-session call under repeated clicks', async () => {
    const localSession = deferred<{ expiresAt: string }>();
    const api = fakeApi({
      getSession: vi.fn().mockRejectedValue(new PilotApiError(401, 'UNAUTHENTICATED')),
      createLocalSession: vi.fn().mockImplementation(() => localSession.promise),
    });
    render(<PilotApp api={api}/>);
    const owner = await screen.findByRole('button', { name: '以宠主身份进入' });
    const provider = screen.getByRole('button', { name: '以服务人员身份进入' });
    const admin = screen.getByRole('button', { name: '以平台管理员身份进入' });

    act(() => {
      fireEvent.click(owner);
      fireEvent.click(owner);
    });

    expect(api.createLocalSession).toHaveBeenCalledOnce();
    expect(api.createLocalSession).toHaveBeenCalledWith('OWNER');
    expect((owner as HTMLButtonElement).disabled).toBe(true);
    expect((provider as HTMLButtonElement).disabled).toBe(true);
    expect((admin as HTMLButtonElement).disabled).toBe(true);
    await act(async () => localSession.resolve({ expiresAt: adminSession.expiresAt }));
  });

  it('keeps nickname onboarding after direct entry', async () => {
    const ownerWithoutName = {
      ...adminSession, userId: 'owner-1', role: 'OWNER' as const, displayName: null,
    };
    const getSession = vi.fn()
      .mockRejectedValueOnce(new PilotApiError(401, 'UNAUTHENTICATED'))
      .mockResolvedValueOnce(ownerWithoutName)
      .mockResolvedValueOnce({ ...ownerWithoutName, displayName: '秦淮宠主' });
    const api = fakeApi({
      getSession,
      updateProfile: vi.fn().mockResolvedValue({
        id: 'owner-1', role: 'OWNER', displayName: '秦淮宠主',
      }),
    });
    const user = userEvent.setup();
    render(<PilotApp api={api}/>);

    await user.click(await screen.findByRole('button', { name: '以宠主身份进入' }));
    expect(api.createLocalSession).toHaveBeenCalledWith('OWNER');
    expect(await screen.findByRole('heading', { name: '设置展示昵称' })).toBeTruthy();
    expect(screen.getByText('昵称不是实名，也不用于登录或线下身份核验。')).toBeTruthy();
    await user.type(screen.getByLabelText('展示昵称'), '秦淮宠主');
    await user.click(screen.getByRole('button', { name: '保存昵称' }));
    expect(api.updateProfile).toHaveBeenCalledWith('秦淮宠主');
    expect(await screen.findByRole('heading', { name: '宠主工作区' })).toBeTruthy();
  });

  it('mounts a provider workspace keyed to the authenticated server identity', async () => {
    const api = fakeApi({
      getSession: vi.fn().mockResolvedValue({
        userId: 'provider-1', role: 'PROVIDER', displayName: '秦淮小周',
        expiresAt: '2026-09-03T10:00:00.000Z',
      }),
    });
    render(<PilotApp api={api}/>);

    expect(await screen.findByRole('heading', { name: '服务人员工作区' })).toBeTruthy();
    expect(screen.getByText('当前身份：秦淮小周')).toBeTruthy();
    expect(screen.queryByText('接单与履约功能将在下一阶段接入共享试运营数据。')).toBeNull();
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
    expect(await screen.findByRole('heading', { name: '平台工作区' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));

    await waitFor(() => expect(api.deleteSession).toHaveBeenCalledOnce());
    expect(await screen.findByRole('button', { name: '以宠主身份进入' })).toBeTruthy();
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

    expect(await screen.findByRole('button', { name: '以宠主身份进入' })).toBeTruthy();
    expect(screen.queryByText('邀请码管理')).toBeNull();
    expect(api.listInvites).not.toHaveBeenCalled();
  });

  it('clears the protected workspace when an admin request returns 401', async () => {
    const api = fakeApi({
      listAdminOrders: vi.fn().mockRejectedValue(new PilotApiError(401, 'UNAUTHENTICATED')),
    });
    render(<PilotApp api={api}/>);

    expect(await screen.findByRole('button', { name: '以宠主身份进入' })).toBeTruthy();
    expect(api.listAdminOrders).toHaveBeenCalledOnce();
    expect(screen.queryByRole('heading', { name: '平台工作区' })).toBeNull();
  });

  it('never opens a protected workspace for an invalid runtime display name', async () => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      userId: 'admin-1', role: 'ADMIN', displayName: ' 未修剪昵称',
      expiresAt: '2026-09-03T10:00:00.000Z',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    render(<PilotApp api={api}/>);

    expect((await screen.findByRole('alert')).textContent).toContain('服务暂时不可用，请稍后重试');
    expect(screen.queryByRole('heading', { name: '平台工作区' })).toBeNull();
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
    expect(screen.getByRole('heading', { name: '平台工作区' })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(2_147_483_647); });
    expect(screen.getByRole('heading', { name: '平台工作区' })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1_000 - 2_147_483_647); });
    expect(screen.getByRole('button', { name: '以宠主身份进入' })).toBeTruthy();
  });

  it('renders the admin workspace without invitation management and labels the shell local pilot', async () => {
    render(<PilotApp api={fakeApi()}/>);
    expect(await screen.findByRole('heading', { name: '平台工作区' })).toBeTruthy();
    expect(screen.getByText('本地试运营')).toBeTruthy();
    expect(screen.queryByText('邀请码管理')).toBeNull();
    expect(screen.queryByText('邀请制试运营')).toBeNull();
  });
});
