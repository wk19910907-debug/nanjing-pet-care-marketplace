import { describe, expect, it } from 'vitest';
import { createApiClient, type RequestTransport } from '../services/api.js';
import { createSessionStore } from '../services/session.js';

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
      method: 'POST', url: 'https://api.example.test/v1/orders',
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
});
