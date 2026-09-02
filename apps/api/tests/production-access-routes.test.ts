import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const origin = 'https://pilot.example.com';
const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);
const owner = { userId: '11111111-1111-4111-8111-111111111111', role: 'OWNER' as const,
  displayName: '访客宠主', expiresAt, mustChangePassword: false, staffPasswordChangedAt: null };
const admin = { userId: '22222222-2222-4222-8222-222222222222', role: 'ADMIN' as const,
  displayName: '管理员', expiresAt, mustChangePassword: false, staffPasswordChangedAt: new Date() };

function appWithProductionAccess() {
  const sessions = {
    authenticate: async (authorization: string | undefined) => authorization === 'Bearer admin-token' ? admin : owner,
    revoke: async () => undefined,
  };
  const app = createApp({
    auth: { authenticate: sessions.authenticate }, pets: {}, addresses: {},
    pilot: {
      config: {
        nodeEnv: 'production', databaseUrl: 'postgresql://unused',
        pilot: { enabled: true, host: '127.0.0.1', port: 43124, publicOrigin: origin,
          authPepper: Buffer.alloc(32, 1), sessionDays: 7, inviteHours: 24, secureCookies: true },
      },
      sessions,
      publicOwnerAccess: {
        ensureOwnerSession: async () => ({ created: true, session: { token: 'owner-token', expiresAt }, expiresAt }),
        issueRecovery: async () => ({ token: 'recovery-token', recoveryPath: '/#/orders/access/recovery-token' }),
        rotateRecovery: async () => ({ token: 'rotated-token', recoveryPath: '/#/orders/access/rotated-token' }),
        recover: async (token: string) => {
          if (token === 'invalid') throw new Error('RECOVERY_INVALID');
          return { token: 'recovered-token', expiresAt };
        },
      },
      staffCredentials: {
        login: async (username: string) => {
          if (username === 'busy') throw new Error('STAFF_LOGIN_BUSY');
          return { session: { token: 'staff-token', expiresAt }, mustChangePassword: true };
        },
        changePassword: async () => ({ session: { token: 'changed-token', expiresAt }, mustChangePassword: false }),
        list: async () => [{ userId: '33333333-3333-4333-8333-333333333333', username: 'provider.one', displayName: '服务员', role: 'PROVIDER' as const, mustChangePassword: true, disabledAt: null, createdAt: '2026-01-01T00:00:00.000Z' }],
        createProvider: async () => ({ userId: '33333333-3333-4333-8333-333333333333', username: 'provider.one', displayName: '服务员', role: 'PROVIDER' as const, mustChangePassword: true, disabledAt: null, createdAt: '2026-01-01T00:00:00.000Z' }),
        setDisabled: async () => ({ userId: '33333333-3333-4333-8333-333333333333', username: 'provider.one', displayName: '服务员', role: 'PROVIDER' as const, mustChangePassword: true, disabledAt: null, createdAt: '2026-01-01T00:00:00.000Z' }),
        resetPassword: async () => undefined,
      },
    },
  } as never);
  return app;
}

describe('production access routes', () => {
  it('creates a guest session with a protected cookie and refuses ambient cross-origin writes', async () => {
    const app = appWithProductionAccess();
    await app.ready();
    try {
      const created = await app.inject({ method: 'POST', url: '/api/v1/public/owner-sessions', headers: { origin }, payload: {} });
      const crossOrigin = await app.inject({ method: 'POST', url: '/api/v1/public/owner-sessions', headers: { origin: 'https://attacker.example' }, payload: {} });
      const extraField = await app.inject({ method: 'POST', url: '/api/v1/public/owner-sessions', headers: { origin }, payload: { role: 'ADMIN' } });
      const localRole = await app.inject({ method: 'POST', url: '/api/v1/pilot/local-sessions', headers: { origin }, payload: { role: 'ADMIN' } });

      expect(created.statusCode).toBe(201);
      expect(created.headers['set-cookie']).toMatch(/HttpOnly.*Secure.*SameSite=Lax/i);
      expect(created.headers['set-cookie']).toMatch(/Path=\//i);
      expect(created.headers['cache-control']).toBe('no-store');
      expect(created.headers['referrer-policy']).toBe('no-referrer');
      expect(JSON.stringify(created.json())).not.toMatch(/passwordHash|tokenHash|cookie|owner-token/i);
      expect(crossOrigin).toMatchObject({ statusCode: 403 });
      expect(extraField).toMatchObject({ statusCode: 400 });
      expect(localRole).toMatchObject({ statusCode: 404 });
    } finally {
      await app.close();
    }
  });

  it('exposes recovery, staff and administrator contracts without session tokens', async () => {
    const app = appWithProductionAccess();
    await app.ready();
    try {
      const headers = { origin, cookie: 'petcare_pilot_session=owner-token' };
      const issued = await app.inject({ method: 'POST', url: '/api/v1/public/owner-recovery-credentials', headers, payload: {} });
      const rotated = await app.inject({ method: 'POST', url: '/api/v1/public/owner-recovery-credentials/rotate', headers, payload: {} });
      const recovered = await app.inject({ method: 'POST', url: '/api/v1/public/owner-recovery-sessions', headers: { origin }, payload: { token: 'recovery-token' } });
      const login = await app.inject({ method: 'POST', url: '/api/v1/staff/sessions', headers: { origin }, payload: { username: 'admin.user', password: 'a'.repeat(12) } });
      const changed = await app.inject({ method: 'PATCH', url: '/api/v1/staff/password', headers: { origin, cookie: 'petcare_pilot_session=admin-token' }, payload: { password: 'b'.repeat(12) } });
      const listed = await app.inject({ method: 'GET', url: '/api/v1/admin/staff-accounts', headers: { cookie: 'petcare_pilot_session=admin-token' } });
      const reset = await app.inject({ method: 'POST', url: '/api/v1/admin/staff-accounts/33333333-3333-4333-8333-333333333333/reset-password', headers: { origin, cookie: 'petcare_pilot_session=admin-token' }, payload: { temporaryPassword: 'c'.repeat(12) } });
      const created = await app.inject({ method: 'POST', url: '/api/v1/admin/staff-accounts', headers: { origin, cookie: 'petcare_pilot_session=admin-token' }, payload: { username: 'provider.two', displayName: '新服务员', temporaryPassword: 'd'.repeat(12) } });
      const disabled = await app.inject({ method: 'PATCH', url: '/api/v1/admin/staff-accounts/33333333-3333-4333-8333-333333333333', headers: { origin, cookie: 'petcare_pilot_session=admin-token' }, payload: { disabled: true } });
      const invalidRecovery = await app.inject({ method: 'POST', url: '/api/v1/public/owner-recovery-sessions', headers: { origin }, payload: { token: 'invalid' } });
      const busyLogin = await app.inject({ method: 'POST', url: '/api/v1/staff/sessions', headers: { origin }, payload: { username: 'busy', password: 'a'.repeat(12) } });
      const oversized = await app.inject({ method: 'POST', url: '/api/v1/staff/sessions', headers: { origin }, payload: { username: 'admin.user', password: 'a'.repeat(2_100) } });

      expect(issued).toMatchObject({ statusCode: 201 });
      expect(rotated).toMatchObject({ statusCode: 200 });
      expect(recovered).toMatchObject({ statusCode: 201 });
      expect(login).toMatchObject({ statusCode: 201 });
      expect(login.json()).toMatchObject({ mustChangePassword: true });
      expect(changed).toMatchObject({ statusCode: 200 });
      expect(listed).toMatchObject({ statusCode: 200 });
      expect(listed.json()).toEqual([expect.objectContaining({ username: 'provider.one' })]);
      expect(reset).toMatchObject({ statusCode: 204 });
      expect(created).toMatchObject({ statusCode: 201 });
      expect(disabled).toMatchObject({ statusCode: 200 });
      expect(invalidRecovery).toMatchObject({ statusCode: 401, json: expect.any(Function) });
      expect(invalidRecovery.json()).toEqual({ code: 'RECOVERY_INVALID' });
      expect(busyLogin.json()).toEqual({ code: 'STAFF_LOGIN_BUSY' });
      expect(busyLogin.statusCode).toBe(429);
      expect(oversized.statusCode).toBe(413);
      for (const response of [issued, rotated, recovered, login, changed, listed, created, disabled]) {
        expect(response.headers['cache-control']).toBe('no-store');
        expect(JSON.stringify(response.json())).not.toMatch(/passwordHash|tokenHash|staff-token|changed-token|recovered-token/i);
      }
    } finally {
      await app.close();
    }
  });
});
