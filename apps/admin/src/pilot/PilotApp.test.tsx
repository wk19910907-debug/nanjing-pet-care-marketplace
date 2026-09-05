// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PilotApi } from './api.js';
import { createPilotApi, PilotApiError } from './api.js';
import { PilotApp } from './PilotApp.js';

const adminSession = {
  userId: 'admin-1', role: 'ADMIN' as const, displayName: '试点运营',
  expiresAt: '2027-09-03T10:00:00.000Z', mustChangePassword: false,
};
const publicCatalog = {
  services: {
    CAT_FEEDING: { enabled: true, basePriceFen: 3_200 },
    DOG_WALKING: { enabled: true, basePriceFen: 3_700 },
  },
  openDistricts: ['JIANYE', 'GULOU', 'XUANWU', 'QINHUAI'] as Array<'JIANYE' | 'GULOU' | 'XUANWU' | 'QINHUAI'>,
  announcement: '',
};

function fakeApi(overrides: Partial<PilotApi> = {}): PilotApi {
  return {
    getSession: vi.fn().mockResolvedValue(adminSession),
    createSession: vi.fn().mockResolvedValue({ expiresAt: adminSession.expiresAt }),
    createLocalSession: vi.fn().mockResolvedValue({ expiresAt: adminSession.expiresAt }),
    ensureOwnerSession: vi.fn().mockResolvedValue({ expiresAt: adminSession.expiresAt }),
    issueRecoveryCredential: vi.fn().mockRejectedValue(new PilotApiError(409, 'RECOVERY_ALREADY_ISSUED')), rotateRecoveryCredential: vi.fn(), recoverOwnerSession: vi.fn(),
    createStaffSession: vi.fn(), changeStaffPassword: vi.fn(),
    listStaffAccounts: vi.fn().mockResolvedValue([]), createStaffAccount: vi.fn(),
    updateStaffAccount: vi.fn(), resetStaffPassword: vi.fn(),
    listOrderMessages: vi.fn(), sendOrderMessage: vi.fn(),
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
    getCatalog: vi.fn().mockResolvedValue(publicCatalog),
    getAdminCatalog: vi.fn().mockResolvedValue({
      ...publicCatalog, version: 1, updatedAt: '2026-08-29T08:00:00.000Z',
    }),
    updateAdminCatalog: vi.fn(),
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

  it('renders one guest owner entry and keeps staff access out of the booking journey', async () => {
    const api = fakeApi({
      getSession: vi.fn().mockRejectedValue(new PilotApiError(401, 'UNAUTHENTICATED')),
    });
    render(<PilotApp api={api}/>);

    expect(await screen.findByRole('button', { name: '立即预约' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '员工登录' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '熟悉的家，安心的照护' })).toBeTruthy();
    expect(screen.queryByLabelText('邀请码')).toBeNull();
    expect(screen.queryByText('以服务人员身份进入')).toBeNull();
    expect(screen.queryByText('以平台管理员身份进入')).toBeNull();
    expect(document.body.textContent).not.toMatch(/邀请码|手机号|微信号|邮箱/);
  });

  it('recovers the public service catalog after a transient first-load failure', async () => {
    const getCatalog = vi.fn()
      .mockRejectedValueOnce(new Error('temporary catalog failure'))
      .mockResolvedValueOnce(publicCatalog);
    const api = fakeApi({
      getSession: vi.fn().mockRejectedValue(new PilotApiError(401, 'UNAUTHENTICATED')),
      getCatalog,
    });
    render(<PilotApp api={api}/>);

    const retry = await screen.findByRole('button', { name: '重新加载服务' });
    await userEvent.click(retry);

    expect(await screen.findByRole('button', { name: '预约上门喂猫' })).toBeTruthy();
    expect(getCatalog).toHaveBeenCalledTimes(2);
  });

  it('creates one guest owner session under repeated booking clicks then opens the booking flow', async () => {
    const owner = { ...adminSession, userId: 'owner-1', role: 'OWNER' as const, displayName: '秦淮宠主' };
    const getSession = vi.fn()
      .mockRejectedValueOnce(new PilotApiError(401, 'UNAUTHENTICATED'))
      .mockResolvedValue(owner);
    const sessionRequest = deferred<{ expiresAt: string }>();
    const api = fakeApi({ getSession, ensureOwnerSession: vi.fn().mockImplementation(() => sessionRequest.promise), issueRecoveryCredential: vi.fn().mockRejectedValue(new PilotApiError(409, 'RECOVERY_ALREADY_ISSUED')) });
    render(<PilotApp api={api}/>);
    await screen.findAllByRole('button', { name: '立即预约' });
    act(() => {
      for (const button of screen.getAllByRole('button', { name: '立即预约' })) fireEvent.click(button);
    });
    expect(api.ensureOwnerSession).toHaveBeenCalledOnce();
    await act(async () => sessionRequest.resolve({ expiresAt: adminSession.expiresAt }));
    expect(await screen.findByRole('heading', { name: '服务与时间' })).toBeTruthy();
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

    await user.click((await screen.findAllByRole('button', { name: '立即预约' }))[0]!);
    expect(api.ensureOwnerSession).toHaveBeenCalledOnce();
    expect(await screen.findByRole('heading', { name: '设置展示昵称' })).toBeTruthy();
    expect(screen.getByText('昵称不是实名，也不用于登录或线下身份核验。')).toBeTruthy();
    await user.type(screen.getByLabelText('展示昵称'), '秦淮宠主');
    await user.click(screen.getByRole('button', { name: '保存昵称' }));
    expect(api.updateProfile).toHaveBeenCalledWith('秦淮宠主');
    expect(await screen.findByRole('heading', { name: '今天需要照顾谁？' })).toBeTruthy();
  });

  it('mounts a provider workspace keyed to the authenticated server identity', async () => {
    const api = fakeApi({
      getSession: vi.fn().mockResolvedValue({
        userId: 'provider-1', role: 'PROVIDER', displayName: '秦淮小周',
        expiresAt: '2027-09-03T10:00:00.000Z',
      }),
    });
    render(<PilotApp api={api}/>);

    expect(await screen.findByRole('heading', { name: '服务人员工作区' })).toBeTruthy();
    expect(screen.getByText('当前身份：秦淮小周')).toBeTruthy();
    expect(screen.queryByText('接单与履约功能将在下一阶段接入共享试运营数据。')).toBeNull();
  });

  it('clears a recovery fragment before restoring the cookie session', async () => {
    const token = 'r'.repeat(43);
    window.history.replaceState(null, '', `/#/orders/access/${token}`);
    const replace = vi.spyOn(window.history, 'replaceState');
    const api = fakeApi({
      recoverOwnerSession: vi.fn().mockImplementation(async () => {
        expect(window.location.hash).toBe('');
      }),
      getSession: vi.fn().mockResolvedValue({ ...adminSession, userId: 'owner-1', role: 'OWNER' as const, displayName: '秦淮宠主' }),
    });
    render(<PilotApp api={api}/>);
    expect(await screen.findByRole('heading', { name: '今天需要照顾谁？' })).toBeTruthy();
    expect(replace).toHaveBeenCalledWith(null, '', '/');
    expect(api.recoverOwnerSession).toHaveBeenCalledWith(token);
  });

  it('shows password change before every staff workspace and survives reload from the session DTO', async () => {
    const changing = { ...adminSession, role: 'PROVIDER' as const, userId: 'provider-1', displayName: '秦淮小周', mustChangePassword: true };
    const getSession = vi.fn().mockResolvedValueOnce(changing).mockResolvedValueOnce({ ...changing, mustChangePassword: false });
    const api = fakeApi({ getSession, changeStaffPassword: vi.fn().mockResolvedValue({ expiresAt: adminSession.expiresAt, mustChangePassword: false }) });
    const user = userEvent.setup();
    render(<PilotApp api={api}/>);
    expect(await screen.findByRole('heading', { name: '请先修改临时密码' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '服务人员工作区' })).toBeNull();
    await user.type(screen.getByLabelText('新密码'), 'Changed-password-2026');
    await user.type(screen.getByLabelText('确认新密码'), 'Changed-password-2026');
    await user.click(screen.getByRole('button', { name: '保存新密码' }));
    expect(await screen.findByRole('heading', { name: '服务人员工作区' })).toBeTruthy();
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
    expect(await screen.findByRole('button', { name: '员工登录' })).toBeTruthy();
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

    expect(await screen.findByRole('button', { name: '员工登录' })).toBeTruthy();
    expect(screen.queryByText('邀请码管理')).toBeNull();
    expect(api.listInvites).not.toHaveBeenCalled();
  });

  it('clears the protected workspace when an admin request returns 401', async () => {
    const api = fakeApi({
      listAdminOrders: vi.fn().mockRejectedValue(new PilotApiError(401, 'UNAUTHENTICATED')),
    });
    render(<PilotApp api={api}/>);

    expect(await screen.findByRole('button', { name: '员工登录' })).toBeTruthy();
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
    expect(screen.getByRole('button', { name: '员工登录' })).toBeTruthy();
  });

  it('renders the admin workspace without invitation management in the formal service shell', async () => {
    render(<PilotApp api={fakeApi()}/>);
    expect(await screen.findByRole('heading', { name: '平台工作区' })).toBeTruthy();
    expect(screen.getByText('南京 · 上门宠物照护')).toBeTruthy();
    expect(document.body.textContent).not.toContain('本地试运营');
    expect(screen.queryByText('邀请码管理')).toBeNull();
    expect(screen.queryByText('邀请制试运营')).toBeNull();
  });
});
