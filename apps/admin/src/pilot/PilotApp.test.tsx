// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PilotApi } from './api.js';
import { createPilotApi, PilotApiError } from './api.js';
import { FirstOrderRecoveryDelivery, PilotApp } from './PilotApp.js';

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
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
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
    expect(api.issueRecoveryCredential).not.toHaveBeenCalled();
  });

  it('repairs a lost first-credential response through an explicit safe rotation', async () => {
    const delivered = vi.fn();
    const issueRecoveryCredential = vi.fn()
      .mockRejectedValueOnce(new PilotApiError(503, 'SERVICE_UNAVAILABLE'))
      .mockRejectedValueOnce(new PilotApiError(409, 'RECOVERY_ALREADY_ISSUED'));
    const rotateRecoveryCredential = vi.fn().mockResolvedValue({
      userId: 'owner-1', token: 'n'.repeat(43), recoveryPath: '/#/orders/access/' + 'n'.repeat(43),
    });
    const user = userEvent.setup();
    render(<FirstOrderRecoveryDelivery
      api={fakeApi({ issueRecoveryCredential, rotateRecoveryCredential })}
      expectedOwnerUserId="owner-1"
      onDelivered={delivered}
    />);

    expect(await screen.findByRole('heading', { name: '恢复凭据尚未交付' })).toBeTruthy();
    expect(screen.getByText(/订单已经提交成功/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '重试获取恢复凭据' }));

    expect(await screen.findByRole('heading', { name: '需要安全轮换恢复凭据' })).toBeTruthy();
    expect(screen.getByText(/原凭据可能已经签发/)).toBeTruthy();
    expect(rotateRecoveryCredential).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '安全轮换并显示新凭据' }));

    await waitFor(() => expect(delivered).toHaveBeenCalledWith({
      userId: 'owner-1', token: 'n'.repeat(43), recoveryPath: '/#/orders/access/' + 'n'.repeat(43),
    }));
    expect(issueRecoveryCredential).toHaveBeenCalledTimes(2);
    expect(rotateRecoveryCredential).toHaveBeenCalledOnce();
  });

  it('does not expose a first-order credential authenticated for another cookie owner', async () => {
    const foreignToken = 'f'.repeat(43);
    const delivered = vi.fn();
    render(<FirstOrderRecoveryDelivery
      api={fakeApi({ issueRecoveryCredential: vi.fn().mockResolvedValue({
        userId: 'owner-2', token: foreignToken, recoveryPath: '/#/orders/access/' + foreignToken,
      }) })}
      expectedOwnerUserId="owner-1"
      onDelivered={delivered}
    />);

    expect(await screen.findByRole('heading', { name: '账户状态已变化' })).toBeTruthy();
    expect(delivered).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(foreignToken);
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

  it('single-flights recovery rotation, shows the newest credential, and restores focus after closing it', async () => {
    const owner = { ...adminSession, userId: 'owner-1', role: 'OWNER' as const, displayName: '秦淮宠主' };
    const rotation = deferred<Awaited<ReturnType<PilotApi['rotateRecoveryCredential']>>>();
    const api = fakeApi({
      getSession: vi.fn().mockResolvedValue(owner),
      rotateRecoveryCredential: vi.fn().mockImplementation(() => rotation.promise),
    });
    const user = userEvent.setup();
    render(<PilotApp api={api}/>);
    const trigger = await screen.findByRole('button', { name: '生成新的恢复凭据' });
    await user.click(trigger); await user.click(trigger);
    expect(api.rotateRecoveryCredential).toHaveBeenCalledOnce();
    expect((screen.getByRole('button', { name: '正在生成…' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => rotation.resolve({ userId: 'owner-1', token: 'z'.repeat(43), recoveryPath: '/#/orders/access/' + 'z'.repeat(43) }));
    expect(await screen.findByRole('dialog', { name: '保存你的恢复凭据' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '复制恢复链接' }));
    await user.click(screen.getByRole('button', { name: '我已保存' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '生成新的恢复凭据' })));
  });

  it('does not expose a manual rotation credential issued for a cookie owner from another tab', async () => {
    const owner = { ...adminSession, userId: 'owner-1', role: 'OWNER' as const, displayName: '秦淮宠主' };
    const foreignToken = 'b'.repeat(43);
    const api = fakeApi({
      getSession: vi.fn().mockResolvedValue(owner),
      rotateRecoveryCredential: vi.fn().mockResolvedValue({
        userId: 'owner-2', token: foreignToken, recoveryPath: '/#/orders/access/' + foreignToken,
      }),
    });
    render(<PilotApp api={api}/>);

    await userEvent.click(await screen.findByRole('button', { name: '生成新的恢复凭据' }));
    await waitFor(() => expect(api.rotateRecoveryCredential).toHaveBeenCalledOnce());
    expect(screen.queryByRole('dialog', { name: '保存你的恢复凭据' })).toBeNull();
    expect(document.body.textContent).not.toContain(foreignToken);
  });

  it('ignores a late recovery rotation response after the owner session has changed', async () => {
    const owner = { ...adminSession, userId: 'owner-1', role: 'OWNER' as const, displayName: '秦淮宠主' };
    const rotation = deferred<Awaited<ReturnType<PilotApi['rotateRecoveryCredential']>>>();
    const getSession = vi.fn().mockResolvedValueOnce(owner).mockRejectedValueOnce(new PilotApiError(401, 'UNAUTHENTICATED'));
    const api = fakeApi({ getSession, rotateRecoveryCredential: vi.fn().mockImplementation(() => rotation.promise) });
    const user = userEvent.setup();
    render(<PilotApp api={api}/>);
    await user.click(await screen.findByRole('button', { name: '生成新的恢复凭据' }));
    await user.click(screen.getByRole('button', { name: '退出登录' }));
    expect(await screen.findByRole('button', { name: '员工登录' })).toBeTruthy();
    await act(async () => rotation.resolve({ userId: 'owner-1', token: 'late'.padEnd(43, 'x'), recoveryPath: '/#/orders/access/' + 'late'.padEnd(43, 'x') }));
    expect(screen.queryByRole('dialog', { name: '保存你的恢复凭据' })).toBeNull();
  });

  it('serializes rotation across logout and same-owner recovery, then shows only the final server rotation', async () => {
    const owner = { ...adminSession, userId: 'owner-1', role: 'OWNER' as const, displayName: '秦淮宠主' };
    const first = deferred<Awaited<ReturnType<PilotApi['rotateRecoveryCredential']>>>();
    const second = deferred<Awaited<ReturnType<PilotApi['rotateRecoveryCredential']>>>();
    const getSession = vi.fn().mockResolvedValueOnce(owner).mockRejectedValueOnce(new PilotApiError(401, 'UNAUTHENTICATED')).mockResolvedValueOnce(owner);
    const rotateRecoveryCredential = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const api = fakeApi({ getSession, rotateRecoveryCredential, recoverOwnerSession: vi.fn().mockResolvedValue({ expiresAt: adminSession.expiresAt }) });
    const user = userEvent.setup();
    render(<PilotApp api={api}/>);
    await user.click(await screen.findByRole('button', { name: '生成新的恢复凭据' }));
    await user.click(screen.getByRole('button', { name: '退出登录' }));
    await user.click(await screen.findByRole('button', { name: '恢复订单' }));
    await user.type(screen.getByLabelText('恢复凭据'), 'r'.repeat(43));
    await user.click(screen.getByRole('button', { name: '恢复我的订单' }));
    const blocked = await screen.findByRole('button', { name: '正在生成…' });
    expect((blocked as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(blocked);
    expect(rotateRecoveryCredential).toHaveBeenCalledOnce();
    await act(async () => first.resolve({ userId: 'owner-1', token: 'old'.padEnd(43, 'x'), recoveryPath: '/#/orders/access/' + 'old'.padEnd(43, 'x') }));
    expect(screen.queryByRole('dialog', { name: '保存你的恢复凭据' })).toBeNull();
    await user.click(await screen.findByRole('button', { name: '生成新的恢复凭据' }));
    await act(async () => second.resolve({ userId: 'owner-1', token: 'new'.padEnd(43, 'y'), recoveryPath: '/#/orders/access/' + 'new'.padEnd(43, 'y') }));
    expect(await screen.findByRole('dialog', { name: '保存你的恢复凭据' })).toBeTruthy();
    expect(rotateRecoveryCredential).toHaveBeenCalledTimes(2);
  });

  it('clears a pending recovery credential on session expiry before its request resolves', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
    const owner = { ...adminSession, userId: 'owner-1', role: 'OWNER' as const, displayName: '秦淮宠主', expiresAt: '2026-08-01T00:00:01.000Z' };
    const rotation = deferred<Awaited<ReturnType<PilotApi['rotateRecoveryCredential']>>>();
    const api = fakeApi({ getSession: vi.fn().mockResolvedValue(owner), rotateRecoveryCredential: vi.fn().mockImplementation(() => rotation.promise) });
    render(<PilotApp api={api}/>);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: '生成新的恢复凭据' }));
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole('button', { name: '员工登录' })).toBeTruthy();
    await act(async () => rotation.resolve({ userId: 'owner-1', token: 'expired'.padEnd(43, 'x'), recoveryPath: '/#/orders/access/' + 'expired'.padEnd(43, 'x') }));
    expect(screen.queryByRole('dialog', { name: '保存你的恢复凭据' })).toBeNull();
  });

  it('clears a pending recovery credential after a protected-request 401', async () => {
    const owner = { ...adminSession, userId: 'owner-1', role: 'OWNER' as const, displayName: '秦淮宠主' };
    const rotation = deferred<Awaited<ReturnType<PilotApi['rotateRecoveryCredential']>>>();
    const api = fakeApi({
      getSession: vi.fn().mockResolvedValueOnce(owner).mockResolvedValueOnce(owner),
      rotateRecoveryCredential: vi.fn().mockImplementation(() => rotation.promise),
      recoverOwnerSession: vi.fn().mockResolvedValue({ expiresAt: adminSession.expiresAt }),
      listOrders: vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new PilotApiError(401, 'UNAUTHENTICATED')).mockResolvedValueOnce([]),
    });
    const user = userEvent.setup();
    render(<PilotApp api={api}/>);
    await user.click(await screen.findByRole('button', { name: '生成新的恢复凭据' }));
    await user.click(screen.getByRole('button', { name: '刷新' }));
    expect(await screen.findByRole('button', { name: '员工登录' })).toBeTruthy();
    await act(async () => rotation.resolve({ userId: 'owner-1', token: 'forbidden'.padEnd(43, 'x'), recoveryPath: '/#/orders/access/' + 'forbidden'.padEnd(43, 'x') }));
    expect(screen.queryByRole('dialog', { name: '保存你的恢复凭据' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '恢复订单' }));
    await user.type(screen.getByLabelText('恢复凭据'), 'r'.repeat(43));
    await user.click(screen.getByRole('button', { name: '恢复我的订单' }));
    expect(await screen.findByRole('heading', { name: '我的订单' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: '保存你的恢复凭据' })).toBeNull();
  });

  it('clears the session-bound booking intent before a later recovery session', async () => {
    const initialOwner = { ...adminSession, userId: 'owner-1', role: 'OWNER' as const, displayName: '初始宠主' };
    const recoveredOwner = { ...adminSession, userId: 'owner-2', role: 'OWNER' as const, displayName: '恢复宠主' };
    const getSession = vi.fn().mockRejectedValueOnce(new PilotApiError(401, 'UNAUTHENTICATED'))
      .mockResolvedValueOnce(initialOwner).mockResolvedValueOnce(recoveredOwner);
    const api = fakeApi({ getSession, issueRecoveryCredential: vi.fn().mockRejectedValue(new PilotApiError(409, 'RECOVERY_ALREADY_ISSUED')) });
    const user = userEvent.setup();
    render(<PilotApp api={api}/>);
    await user.click((await screen.findAllByRole('button', { name: '立即预约' }))[0]!);
    expect(await screen.findByRole('heading', { name: '服务与时间' })).toBeTruthy();
    window.history.replaceState(null, '', `/#/orders/access/${'s'.repeat(43)}`);
    await api.recoverOwnerSession('s'.repeat(43));
    // A full page reload applies the recovery DTO; the recovered owner must start on home, not a stale booking flow.
    cleanup();
    render(<PilotApp api={api}/>);
    expect(await screen.findByRole('heading', { name: '今天需要照顾谁？' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '服务与时间' })).toBeNull();
  });

  it('shows password change before every staff workspace and survives reload from the session DTO', async () => {
    const changing = { ...adminSession, role: 'PROVIDER' as const, userId: 'provider-1', displayName: '秦淮小周', mustChangePassword: true };
    const getSession = vi.fn().mockResolvedValueOnce(changing).mockResolvedValueOnce({ ...changing, mustChangePassword: false });
    const api = fakeApi({ getSession, changeStaffPassword: vi.fn().mockResolvedValue({ expiresAt: adminSession.expiresAt, mustChangePassword: false }) });
    const user = userEvent.setup();
    render(<PilotApp api={api}/>);
    expect(await screen.findByRole('heading', { name: '请先修改临时密码' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '服务人员工作区' })).toBeNull();
    expect(screen.getByRole('button', { name: '退出登录' }).className).toContain('access-text-button');
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

  it('holds the public entry behind an accessible logout progress view until DELETE settles', async () => {
    const deletion = deferred<void>();
    const getSession = vi.fn().mockResolvedValueOnce(adminSession).mockRejectedValueOnce(new PilotApiError(401, 'UNAUTHENTICATED'));
    const api = fakeApi({ getSession, deleteSession: vi.fn().mockImplementation(() => deletion.promise) });
    render(<PilotApp api={api}/>);

    const logoutButton = await screen.findByRole('button', { name: '退出登录' });
    act(() => { fireEvent.click(logoutButton); fireEvent.click(logoutButton); });
    expect(api.deleteSession).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toContain('正在安全退出');
    expect(screen.queryByRole('button', { name: '立即预约' })).toBeNull();
    expect(screen.queryByRole('button', { name: '恢复订单' })).toBeNull();
    expect(screen.queryByRole('button', { name: '员工登录' })).toBeNull();
    fireEvent.click(document.body);
    expect(api.ensureOwnerSession).not.toHaveBeenCalled();
    expect(api.createStaffSession).not.toHaveBeenCalled();
    expect(api.recoverOwnerSession).not.toHaveBeenCalled();

    await act(async () => deletion.resolve());
    expect(await screen.findByRole('button', { name: '员工登录' })).toBeTruthy();
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it('reconciles a rejected logout before exposing any next session state', async () => {
    const deletion = deferred<void>();
    const getSession = vi.fn().mockResolvedValueOnce(adminSession).mockResolvedValueOnce(adminSession);
    const api = fakeApi({ getSession, deleteSession: vi.fn().mockImplementation(() => deletion.promise) });
    render(<PilotApp api={api}/>);

    fireEvent.click(await screen.findByRole('button', { name: '退出登录' }));
    expect(screen.getByRole('status')).toBeTruthy();
    await act(async () => deletion.reject(new Error('network failed')));
    expect(await screen.findByRole('heading', { name: '平台工作区' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '员工登录' })).toBeNull();
    expect(getSession).toHaveBeenCalledTimes(2);
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
