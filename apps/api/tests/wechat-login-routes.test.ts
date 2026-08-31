import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const url = '/api/v1/auth/wechat/session';
const expiresAt = new Date('2026-09-07T08:00:00Z');
function setup(enabled = true) {
  const login = vi.fn().mockResolvedValue({ token: 'opaque-session', expiresAt, openId: 'never-expose' });
  const sessions = {
    authenticate: vi.fn().mockRejectedValue(new Error('UNAUTHENTICATED')),
    redeem: vi.fn(), createLocalSession: vi.fn(), createInvite: vi.fn(),
    setDisplayName: vi.fn(), revoke: vi.fn(),
  };
  const config = loadConfig({
    DATABASE_URL: 'postgresql://localhost/test', PILOT_MODE: 'enabled',
    PILOT_AUTH_PEPPER: Buffer.alloc(32, 7).toString('base64'),
  });
  config.nodeEnv = 'production';
  config.pilot!.publicOrigin = 'https://pet.example.com';
  const app = createApp({
    auth: sessions, pets: {} as never, addresses: {} as never,
    pilot: { config, sessions, ...(enabled ? { wechatLogin: { login } } : {}) },
  });
  return { app, login };
}

describe('native WeChat login route', () => {
  it('accepts unauthenticated native login in production, returns only a non-cacheable bearer', async () => {
    const { app, login } = setup();
    try {
      const response = await app.inject({ method: 'POST', url, payload: { code: 'code' } });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ token: 'opaque-session', expiresAt: expiresAt.toISOString() });
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.headers['cache-control']).toBe('no-store');
      expect(login).toHaveBeenCalledWith('code');
    } finally { await app.close(); }
  });

  it.each([
    { origin: 'https://evil.example' }, { origin: 'null' },
    { cookie: 'petcare_pilot_session=existing' }, { cookie: 'unrelated=value' },
    { authorization: 'Bearer attacker' },
    { origin: 'https://evil.example', authorization: 'Bearer attacker' },
  ])('rejects browser cross-origin and credential-mixing requests %j', async (headers) => {
    const { app, login } = setup();
    try {
      const response = await app.inject({ method: 'POST', url, headers, payload: { code: 'code' } });
      expect(response.statusCode).toBe(403);
      expect(login).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each([{}, { code: '' }, { code: 'x'.repeat(513) }, { code: 'has spaces' },
    { code: 'code', role: 'ADMIN' }, { code: 'code', openid: 'forged' }])
  ('rejects invalid input without echoing code or extra data %j', async (payload) => {
    const { app, login } = setup();
    try {
      const response = await app.inject({ method: 'POST', url, payload });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ code: 'VALIDATION_ERROR' });
      expect(login).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('fails explicitly when login is disabled', async () => {
    const { app } = setup(false);
    try {
      const response = await app.inject({ method: 'POST', url, payload: { code: 'code' } });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ code: 'WECHAT_LOGIN_UNAVAILABLE' });
    } finally { await app.close(); }
  });

  it.each([['WECHAT_CODE_INVALID', 401], ['FORBIDDEN', 403], ['secret upstream detail', 503]])
  ('maps errors safely %s', async (message, status) => {
    const { app, login } = setup();
    login.mockRejectedValue(new Error(message));
    try {
      const response = await app.inject({ method: 'POST', url, payload: { code: 'code' } });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toEqual({ code: status === 503 ? 'WECHAT_LOGIN_UNAVAILABLE' : message });
    } finally { await app.close(); }
  });

  it('limits all attempts per transport IP and ignores spoofed forwarding headers', async () => {
    const { app, login } = setup();
    try {
      for (let i = 0; i < 10; i++) {
        expect((await app.inject({ method: 'POST', url, payload: { code: `code${i}` },
          headers: { 'x-forwarded-for': `10.0.0.${i}` } })).statusCode).toBe(201);
      }
      const response = await app.inject({ method: 'POST', url, payload: { code: 'next' } });
      expect(response.statusCode).toBe(429);
      expect(response.headers['retry-after']).toBe('60');
      expect(login).toHaveBeenCalledTimes(10);
    } finally { await app.close(); }
  });

  it('keeps all other state-changing API paths origin protected', async () => {
    const { app } = setup();
    try {
      for (const path of ['/api/v1/pilot/me', '/api/v1/auth/wechat/session/extra', '/api/v1/pets']) {
        expect((await app.inject({ method: 'POST', url: path, payload: {} })).statusCode).toBe(403);
      }
    } finally { await app.close(); }
  });

  it.each([
    ['application/json', '{"code":"private', 400],
    ['application/json', JSON.stringify({ code: 'x'.repeat(2049) }), 413],
    ['application/octet-stream', 'private-code', 415],
  ])('returns safe framework errors for %s payload', async (contentType, payload, status) => {
    const { app, login } = setup();
    try {
      const response = await app.inject({ method: 'POST', url, headers: { 'content-type': contentType }, payload });
      expect(response.statusCode).toBe(status);
      expect(response.body).not.toContain('private');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(login).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('releases attempt limits after the fixed window', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { app } = setup();
    try {
      for (let i = 0; i < 10; i++) await app.inject({ method: 'POST', url, payload: {} });
      expect((await app.inject({ method: 'POST', url, payload: { code: 'valid' } })).statusCode).toBe(429);
      clock.mockReturnValue(61_000);
      expect((await app.inject({ method: 'POST', url, payload: { code: 'valid' } })).statusCode).toBe(201);
    } finally { clock.mockRestore(); await app.close(); }
  });

  it('caps global concurrent exchanges and frees capacity after failure', async () => {
    const { app, login } = setup();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let started = 0;
    let ready!: () => void;
    const allStarted = new Promise<void>((resolve) => { ready = resolve; });
    login.mockImplementation(async () => {
      started += 1;
      if (started === 32) ready();
      await pending;
      throw new Error('exchange-failed');
    });
    const requests = Array.from({ length: 32 }, (_, i) => app.inject({ method: 'POST', url,
      remoteAddress: `10.0.0.${i + 1}`, payload: { code: 'code' } }).then((response) => response));
    try {
      await allStarted;
      expect((await app.inject({ method: 'POST', url, remoteAddress: '10.0.1.1', payload: { code: 'code' } })).statusCode).toBe(429);
      release();
      expect((await Promise.all(requests)).every((response) => response.statusCode === 503)).toBe(true);
      login.mockResolvedValue({ token: 'new-token', expiresAt });
      expect((await app.inject({ method: 'POST', url, payload: { code: 'fresh' } })).statusCode).toBe(201);
    } finally { release(); await Promise.all(requests); await app.close(); }
  });

  it('bounds distinct IP keys without evicting live limits, then recovers after expiry', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { app, login } = setup();
    try {
      for (let index = 0; index < 10_000; index++) {
        const remoteAddress = `10.1.${Math.floor(index / 256)}.${index % 256}`;
        const response = await app.inject({ method: 'POST', url, remoteAddress, payload: {} });
        expect(response.statusCode).toBe(400);
      }
      expect(login).not.toHaveBeenCalled();
      expect((await app.inject({ method: 'POST', url, remoteAddress: '10.2.0.1', payload: { code: 'new-ip' } })).statusCode).toBe(429);
      expect((await app.inject({ method: 'POST', url, remoteAddress: '10.1.0.0', payload: { code: 'existing-ip' } })).statusCode).toBe(201);
      clock.mockReturnValue(61_000);
      expect((await app.inject({ method: 'POST', url, remoteAddress: '10.2.0.1', payload: { code: 'new-window' } })).statusCode).toBe(201);
    } finally { clock.mockRestore(); await app.close(); }
  }, 20_000);
});
