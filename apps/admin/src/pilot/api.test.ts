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
});
