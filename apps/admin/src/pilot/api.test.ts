import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIdempotencyKey, createPilotApi, PilotApiError } from './api.js';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

describe('pilot API transport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses same-origin cookies and JSON without touching browser storage', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      userId: 'admin-1',
      role: 'ADMIN',
      displayName: '试点运营',
      expiresAt: '2026-09-03T10:00:00.000Z',
    }));
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);

    await createPilotApi(fetcher).getSession();

    expect(fetcher).toHaveBeenCalledWith('/api/v1/pilot/session', expect.objectContaining({
      credentials: 'same-origin',
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    }));
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('sends a fresh 8-100 character idempotency key with every write', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ expiresAt: '2026-09-03T10:00:00.000Z' }, 201))
      .mockResolvedValueOnce(jsonResponse({
        id: 'owner-1', role: 'OWNER', displayName: '建邺宠主',
      }));
    const api = createPilotApi(fetcher);

    await api.createSession('controlled-invite');
    await api.updateProfile('建邺宠主');

    const first = new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('Idempotency-Key');
    const second = new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('Idempotency-Key');
    expect(first).toMatch(/^.{8,100}$/);
    expect(second).toMatch(/^.{8,100}$/);
    expect(first).not.toBe(second);
    expect(createIdempotencyKey()).toMatch(/^.{8,100}$/);
  });

  it.each([
    [401, 'INVITE_INVALID', 'INVITE_INVALID', '邀请码无效或已失效'],
    [429, 'LOGIN_RATE_LIMITED', 'LOGIN_RATE_LIMITED', '尝试次数过多，请稍后再试'],
    [400, 'DISPLAY_NAME_INVALID', 'DISPLAY_NAME_INVALID', '昵称格式不符合要求'],
    [503, 'SOME_INTERNAL_DETAIL', 'SERVICE_UNAVAILABLE', '服务暂时不可用，请稍后重试'],
  ])('maps %s/%s to safe Chinese copy', async (status, responseCode, code, message) => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ code: responseCode }, status),
    ));

    await expect(api.getSession()).rejects.toMatchObject({
      name: 'PilotApiError', status, code, message,
    } satisfies Partial<PilotApiError>);
  });

  it('does not reveal malformed or non-JSON server errors', async () => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(new Response(
      'database password leaked', { status: 503, headers: { 'Content-Type': 'text/plain' } },
    )));

    await expect(api.getSession()).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: '服务暂时不可用，请稍后重试',
    });
  });

  it('normalizes network failures and malformed successful JSON', async () => {
    const networkApi = createPilotApi(vi.fn<typeof fetch>().mockRejectedValue(
      new Error('Failed to fetch C:\\internal\\secret'),
    ));
    const malformedApi = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(new Response(
      'database row dump', { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(networkApi.getSession()).rejects.toMatchObject({
      status: 503, code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试',
    });
    await expect(malformedApi.getSession()).rejects.toMatchObject({
      status: 503, code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试',
    });
  });

  it.each([
    ['session', (api: ReturnType<typeof createPilotApi>) => api.getSession(), {
      userId: 'owner-1', role: 'ROOT', displayName: null, expiresAt: '2026-09-01T00:00:00.000Z',
    }],
    ['login', (api: ReturnType<typeof createPilotApi>) => api.createSession('invite'), {
      expiresAt: 123,
    }],
    ['nickname', (api: ReturnType<typeof createPilotApi>) => api.updateProfile('昵称'), {
      id: 'owner-1', role: 'OWNER', displayName: null,
    }],
    ['invite creation', (api: ReturnType<typeof createPilotApi>) => api.createInvite('OWNER'), {
      id: 'invite-1', role: 'OWNER', code: 'raw-code', token: 'leaked-token',
      expiresAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-08-28T00:00:00.000Z',
    }],
    ['invite listing', (api: ReturnType<typeof createPilotApi>) => api.listInvites(), [{
      id: 'invite-1', role: 'OWNER', code: 'leaked-code', consumedAt: null,
      expiresAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-08-28T00:00:00.000Z',
    }]],
  ])('rejects invalid successful %s responses with a fixed safe error', async (_name, call, body) => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body)));

    await expect(call(api)).rejects.toMatchObject({
      status: 503, code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试',
    });
  });

  it('normalizes invitation metadata to the explicit allowlist', async () => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([{
      id: 'invite-1', role: 'PROVIDER', consumedAt: null,
      expiresAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-08-28T00:00:00.000Z',
      internalNote: 'must not cross the client boundary',
    }])));

    const records = await api.listInvites();

    expect(records).toEqual([{
      id: 'invite-1', role: 'PROVIDER', consumedAt: null,
      expiresAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-08-28T00:00:00.000Z',
    }]);
    expect(JSON.stringify(records)).not.toContain('internalNote');
  });

  it.each([
    ['session', '', (api: ReturnType<typeof createPilotApi>) => api.getSession()],
    ['session', '   ', (api: ReturnType<typeof createPilotApi>) => api.getSession()],
    ['session', ' 昵称', (api: ReturnType<typeof createPilotApi>) => api.getSession()],
    ['session', '昵称 ', (api: ReturnType<typeof createPilotApi>) => api.getSession()],
    ['session', '昵'.repeat(31), (api: ReturnType<typeof createPilotApi>) => api.getSession()],
    ['profile', '', (api: ReturnType<typeof createPilotApi>) => api.updateProfile('昵称')],
    ['profile', '   ', (api: ReturnType<typeof createPilotApi>) => api.updateProfile('昵称')],
    ['profile', ' 昵称', (api: ReturnType<typeof createPilotApi>) => api.updateProfile('昵称')],
    ['profile', '昵称 ', (api: ReturnType<typeof createPilotApi>) => api.updateProfile('昵称')],
    ['profile', '昵'.repeat(31), (api: ReturnType<typeof createPilotApi>) => api.updateProfile('昵称')],
  ])('rejects invalid %s displayName %j', async (kind, displayName, call) => {
    const body = kind === 'session'
      ? {
          userId: 'owner-1', role: 'OWNER', displayName,
          expiresAt: '2026-09-01T00:00:00.000Z',
        }
      : { id: 'owner-1', role: 'OWNER', displayName };
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body)));

    await expect(call(api)).rejects.toMatchObject({
      status: 503, code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试',
    });
  });

  it.each([
    'rawCode', 'RAW_CODE', 'raw-code', 'raw code',
    'invitationCode', 'invitation_code', 'invitation-code',
    'inviteCode', 'invite_code', 'invite-code',
    'codeHash', 'code_hash', 'code-hash',
    'sessionToken', 'session_token', 'access-token', 'TOKEN',
  ])('rejects credential-like invitation metadata key %s', async (credentialKey) => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([{
      id: 'invite-1', role: 'OWNER', consumedAt: null,
      expiresAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-08-28T00:00:00.000Z',
      [credentialKey]: 'must-not-cross-client-boundary',
    }])));

    await expect(api.listInvites()).rejects.toMatchObject({
      status: 503, code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试',
    });
  });

  it('rejects credential aliases in create responses while allowing the documented code field', async () => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      id: 'invite-1', role: 'OWNER', code: 'one-time-code', raw_code: 'duplicate-secret',
      expiresAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-08-28T00:00:00.000Z',
    }, 201)));

    await expect(api.createInvite('OWNER')).rejects.toMatchObject({
      status: 503, code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试',
    });
  });

  it('does not mistake safe invitation metadata fields for credentials', async () => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([{
      id: 'invite-1', role: 'OWNER', consumedAt: null,
      expiresAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-08-28T00:00:00.000Z',
    }])));

    await expect(api.listInvites()).resolves.toEqual([{
      id: 'invite-1', role: 'OWNER', consumedAt: null,
      expiresAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-08-28T00:00:00.000Z',
    }]);
  });

  it.each([
    'next Thursday',
    '2026-09-01',
    '2026/09/01 00:00:00',
    '2026-02-30T00:00:00.000Z',
    '2026-09-01T00:00:00',
    '2026-09-01 00:00:00Z',
  ])('rejects non-strict API timestamp %s', async (expiresAt) => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      userId: 'owner-1', role: 'OWNER', displayName: null, expiresAt,
    })));

    await expect(api.getSession()).rejects.toMatchObject({
      status: 503, code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试',
    });
  });

  it('accepts a valid ISO-8601 timestamp with an explicit offset', async () => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      userId: 'owner-1', role: 'OWNER', displayName: null,
      expiresAt: '2026-09-01T08:00:00+08:00',
    })));

    await expect(api.getSession()).resolves.toMatchObject({
      expiresAt: '2026-09-01T08:00:00+08:00',
    });
  });

  it('requires logout to return the documented empty 204 response', async () => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true })));

    await expect(api.deleteSession()).rejects.toMatchObject({
      status: 503, code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试',
    });
  });
});
