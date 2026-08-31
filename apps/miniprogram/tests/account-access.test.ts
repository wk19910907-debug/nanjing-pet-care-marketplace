import { expect, it, vi } from 'vitest';
import { createApiClient, ApiError, type RequestSpec } from '../services/api.js';
import { createAccountAccess as createAccess } from '../services/account-access.js';

function createAccountAccess(deps: Omit<Parameters<typeof createAccess>[0], 'saveDisplayName'> & { saveDisplayName?: (name: string) => Promise<void> }) {
  return createAccess({ saveDisplayName: async () => {}, ...deps });
}

const account = { userId: 'user-1', role: 'PROVIDER' as const, displayName: null, expiresAt: '2099-01-01T00:00:00.000Z' };
it('reads a projected session and posts only a trimmed nickname using a native-supported method', async () => {
  const transport = vi.fn(async (_spec: RequestSpec) => ({ statusCode: 200, data: { ...account, secret: 'not exposed' } }));
  const api = createApiClient({ baseUrl: 'https://api.example.com', token: () => 'test-token', transport });
  expect(await api.getSession()).toEqual(account);
  await api.saveDisplayName(' 小橘 ');
  expect(transport.mock.calls[1]?.[0]).toMatchObject({ method: 'POST', url: 'https://api.example.com/api/v1/pilot/me', data: { displayName: '小橘' } });
});
it.each([{}, { ...account, role: 'ROOT' }, { ...account, displayName: 42 }, { ...account, expiresAt: 'invalid' }])('rejects invalid account responses', async (data) => {
  const api = createApiClient({ baseUrl: 'https://api.example.com', token: () => null, transport: async () => ({ statusCode: 200, data }) });
  await expect(api.getSession()).rejects.toThrow();
});
it.each(['', ' ', 'x'.repeat(31)])('does not send invalid nicknames', async (name) => {
  const transport = vi.fn();
  const api = createApiClient({ baseUrl: 'https://api.example.com', token: () => null, transport });
  await expect(api.saveDisplayName(name)).rejects.toThrow('DISPLAY_NAME_INVALID');
  expect(transport).not.toHaveBeenCalled();
});
it('recovers one unauthorized session and checks backend identity after login', async () => {
  const getSession = vi.fn().mockRejectedValueOnce(new ApiError(401, 'UNAUTHENTICATED')).mockResolvedValue(account);
  const login = vi.fn(); const clear = vi.fn();
  const access = createAccountAccess({ getSession, login, clear, development: false });
  expect(await access.load('PROVIDER')).toEqual(account);
  expect(login).toHaveBeenCalledOnce(); expect(clear).toHaveBeenCalledOnce();
});
it.each([new Error('NETWORK_UNAVAILABLE'), new ApiError(403, 'FORBIDDEN'), new Error('UNAUTHENTICATED')])('does not relogin on non-401 failures', async (error) => {
  const login = vi.fn(); const clear = vi.fn();
  const access = createAccountAccess({ getSession: async () => { throw error; }, login, clear, development: false });
  await expect(access.load('PROVIDER')).rejects.toBe(error);
  expect(login).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
});
it('does not promote the production role from a page request', async () => {
  const login = vi.fn();
  const access = createAccountAccess({ getSession: async () => ({ ...account, role: 'OWNER' }), login, clear: vi.fn(), development: false });
  await expect(access.load('PROVIDER')).rejects.toThrow('ACCOUNT_ROLE_MISMATCH'); expect(login).not.toHaveBeenCalled();
});
it('switches a local development role and verifies the new session', async () => {
  const getSession = vi.fn().mockResolvedValueOnce({ ...account, role: 'OWNER' }).mockResolvedValueOnce(account);
  const login = vi.fn();
  const access = createAccountAccess({ getSession, login, clear: vi.fn(), development: true });
  expect(await access.load('PROVIDER')).toEqual(account); expect(login).toHaveBeenCalledWith('PROVIDER');
});
it('coalesces same-role reads and rejects simultaneous role switches', async () => {
  let finish!: (value: typeof account) => void;
  const getSession = vi.fn(() => new Promise<typeof account>((resolve) => { finish = resolve; }));
  const access = createAccountAccess({ getSession, login: vi.fn(), clear: vi.fn(), development: true });
  const first = access.load('PROVIDER'); const second = access.load('PROVIDER');
  await expect(access.load('OWNER')).rejects.toThrow('ACCOUNT_BUSY');
  finish(account); expect(await first).toEqual(await second); expect(getSession).toHaveBeenCalledOnce();
});
it('does not loop when login yields another unauthorized response', async () => {
  const login = vi.fn();
  const access = createAccountAccess({ getSession: async () => { throw new ApiError(401, 'UNAUTHENTICATED'); }, login, clear: vi.fn(), development: false });
  await expect(access.load('OWNER')).rejects.toThrow('UNAUTHENTICATED'); expect(login).toHaveBeenCalledOnce();
});
it('rejects expired sessions even after a login attempt', async () => {
  const login = vi.fn();
  const access = createAccountAccess({ getSession: async () => ({ ...account, expiresAt: '2000-01-01T00:00:00Z' }), login, clear: vi.fn(), development: false });
  await expect(access.load('PROVIDER')).rejects.toThrow('UNAUTHENTICATED'); expect(login).toHaveBeenCalledOnce();
});
it('verifies identity and persisted nickname after save and blocks role switches during save', async () => {
  let finish!: () => void;
  const saveDisplayName = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const getSession = vi.fn().mockResolvedValueOnce(account).mockResolvedValueOnce({ ...account, displayName: '小橘' });
  const access = createAccountAccess({ getSession, saveDisplayName, login: vi.fn(), clear: vi.fn(), development: true });
  const saved = access.save('PROVIDER', '小橘');
  await vi.waitFor(() => expect(saveDisplayName).toHaveBeenCalledOnce());
  await expect(access.load('OWNER')).rejects.toThrow('ACCOUNT_BUSY');
  finish(); expect((await saved).displayName).toBe('小橘');
});
it.each([{ ...account, displayName: null }, { ...account, userId: 'different', displayName: '小橘' }])('does not accept an unconfirmed nickname or changed account', async (after) => {
  const getSession = vi.fn().mockResolvedValueOnce(account).mockResolvedValueOnce(after);
  const access = createAccountAccess({ getSession, login: vi.fn(), clear: vi.fn(), development: false });
  await expect(access.save('PROVIDER', '小橘')).rejects.toThrow('PROFILE_NOT_CONFIRMED');
});
