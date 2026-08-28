// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  afterEach(cleanup);

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

  it.each([
    ['以宠主身份进入', 'OWNER'],
    ['以服务人员身份进入', 'PROVIDER'],
    ['以平台管理员身份进入', 'ADMIN'],
  ] as const)('maps %s to %s', async (action, role) => {
    const getSession = vi.fn()
      .mockRejectedValueOnce(new PilotApiError(401, 'UNAUTHENTICATED'))
      .mockResolvedValue(adminSession);
    const api = fakeApi({ getSession });
    const user = userEvent.setup();
    render(<PilotApp api={api}/>);

    await user.click(await screen.findByRole('button', { name: action }));
    expect(api.createLocalSession).toHaveBeenCalledWith(role);
    await screen.findByRole('heading', { name: '平台工作区' });
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
    const getSession = vi.fn()
      .mockRejectedValueOnce(new PilotApiError(401, 'UNAUTHENTICATED'))
      .mockResolvedValueOnce({ ...adminSession, displayName: null })
      .mockResolvedValueOnce({ ...adminSession, role: 'OWNER', displayName: '秦淮宠主' });
    const api = fakeApi({ getSession });
    const user = userEvent.setup();
    render(<PilotApp api={api}/>);

    await user.click(await screen.findByRole('button', { name: '以宠主身份进入' }));
    expect(api.createLocalSession).toHaveBeenCalledWith('OWNER');
    expect(await screen.findByRole('heading', { name: '设置展示昵称' })).toBeTruthy();
    expect(screen.getByText('昵称不是实名，也不用于登录或线下身份核验。')).toBeTruthy();
    await user.type(screen.getByLabelText('展示昵称'), '秦淮宠主');
    await user.click(screen.getByRole('button', { name: '保存昵称' }));
    expect(await screen.findByRole('heading', { name: '宠主工作区' })).toBeTruthy();
  });

  it('renders the admin workspace without invitation management and labels the shell local pilot', async () => {
    render(<PilotApp api={fakeApi()}/>);
    expect(await screen.findByRole('heading', { name: '平台工作区' })).toBeTruthy();
    expect(screen.getByText('本地试运营')).toBeTruthy();
    expect(screen.queryByText('邀请码管理')).toBeNull();
    expect(screen.queryByText('邀请制试运营')).toBeNull();
  });
});
