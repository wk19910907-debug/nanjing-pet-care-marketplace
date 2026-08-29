import { describe, expect, it } from 'vitest';
import { createApiClient, type RequestTransport } from '../services/api.js';
import { createSessionStore } from '../services/session.js';
import { createWechatLoginAdapter } from '../services/session.js';

describe('mini program API and session adapters', () => {
  it('sends authenticated versioned requests and an idempotency key when creating orders', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const transport: RequestTransport = async (request) => {
      calls.push(request as unknown as Record<string, unknown>);
      return { statusCode: 201, data: { id: 'order-1' } };
    };
    const api = createApiClient({ baseUrl: 'https://api.example.test', token: () => 'session-token', transport });
    await api.createOrder({ serviceType: 'CAT_FEEDING', petIds: ['pet-1'], addressId: 'address-1',
      startsAt: '2026-08-24T10:00:00+08:00', durationMinutes: 30, notes: '' }, 'request-123');
    expect(calls[0]).toMatchObject({
      method: 'POST', url: 'https://api.example.test/api/v1/orders',
      headers: { Authorization: 'Bearer session-token', 'Idempotency-Key': 'request-123' },
    });
  });

  it('rejects non-2xx API responses with a stable public code', async () => {
    const api = createApiClient({
      baseUrl: 'https://api.example.test', token: () => null,
      transport: async () => ({ statusCode: 409, data: { code: 'DISPATCH_CONFLICT' } }),
    });
    await expect(api.acceptInvitation('invite-1')).rejects.toThrow('DISPATCH_CONFLICT');
  });

  it('stores only the opaque session token and clears it on logout', () => {
    const memory = new Map<string, string>();
    const session = createSessionStore({
      get: (key) => memory.get(key), set: (key, value) => memory.set(key, value), remove: (key) => memory.delete(key),
    });
    session.save('opaque-token');
    expect(session.read()).toBe('opaque-token');
    session.clear();
    expect(session.read()).toBeNull();
  });

  it('creates the safe local owner cookie session through the development-only endpoint', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const api = createApiClient({
      baseUrl: 'http://127.0.0.1:3000', token: () => null,
      transport: async (request) => {
        calls.push(request as unknown as Record<string, unknown>);
        return { statusCode: 201, data: { expiresAt: '2026-09-05T00:00:00.000Z' } };
      },
    });
    await api.createLocalOwnerSession();
    expect(calls).toEqual([expect.objectContaining({
      method: 'POST', url: 'http://127.0.0.1:3000/api/v1/pilot/local-sessions',
      data: { role: 'OWNER' }, headers: {},
    })]);
  });

  it('loads and strictly validates the public operations catalog', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const api = createApiClient({
      baseUrl: 'https://api.example.test', token: () => null,
      transport: async (request) => {
        calls.push(request as unknown as Record<string, unknown>);
        return { statusCode: 200, data: {
          services: {
            CAT_FEEDING: { enabled: true, basePriceFen: 3200 },
            DOG_WALKING: { enabled: false, basePriceFen: 3700 },
          },
          openDistricts: ['JIANYE'], announcement: '国庆预约请提前提交',
        } };
      },
    });

    await expect(api.getCatalog()).resolves.toMatchObject({ announcement: '国庆预约请提前提交' });
    expect(calls[0]).toMatchObject({ method: 'GET', url: 'https://api.example.test/api/v1/catalog' });
  });

  it('rejects malformed catalog responses instead of trusting remote data', async () => {
    const api = createApiClient({
      baseUrl: 'https://api.example.test', token: () => null,
      transport: async () => ({ statusCode: 200, data: { services: {}, openDistricts: [] } }),
    });
    await expect(api.getCatalog()).rejects.toThrow();
  });

  it('exchanges only the temporary wx.login code and stores the returned opaque token', async () => {
    const saved: string[] = [];
    const exchanged: unknown[] = [];
    const login = createWechatLoginAdapter({
      wxLogin: async () => ({ code: 'temporary-wx-code', errMsg: 'login:ok' }),
      exchange: async (input) => {
        exchanged.push(input);
        return { token: 'opaque-server-session', expiresAt: '2026-09-05T00:00:00.000Z' };
      },
      saveToken: (token) => saved.push(token),
    });

    await expect(login()).resolves.toMatchObject({ expiresAt: '2026-09-05T00:00:00.000Z' });
    expect(exchanged).toEqual([{ code: 'temporary-wx-code' }]);
    expect(saved).toEqual(['opaque-server-session']);
  });
});
