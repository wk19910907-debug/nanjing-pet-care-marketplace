import type { ActorRole } from '@pet/contracts';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';

const productionOrigin = 'https://pilot.example.com';
const expiresAt = new Date('2026-09-01T08:00:00.000Z');

type SessionRecord = {
  userId: string;
  role: ActorRole;
  displayName: string | null;
  expiresAt: Date;
  revoked: boolean;
};

function pilotConfig(nodeEnv: 'development' | 'production'): AppConfig {
  return {
    nodeEnv,
    databaseUrl: 'postgresql://petcare:petcare@127.0.0.1:54329/pilot-test',
    ...(nodeEnv === 'production' ? {
      production: {
        fieldEncryptionKey: Buffer.alloc(32, 2).toString('base64'),
        objectStorage: {
          endpoint: 'https://objects.example.com',
          bucket: 'pilot-evidence',
          accessKeyId: 'pilot-access-id',
          secretAccessKey: 'pilot-storage-secret',
        },
      },
    } : {}),
    pilot: {
      enabled: true,
      host: '127.0.0.1',
      port: 3000,
      ...(nodeEnv === 'production' ? { publicOrigin: productionOrigin } : {}),
      authPepper: Buffer.alloc(32, 7),
      sessionDays: 7,
      inviteHours: 24,
      secureCookies: nodeEnv === 'production',
    },
  };
}

function createPilotTestApp(nodeEnv: 'development' | 'production' = 'production') {
  const sessions = new Map<string, SessionRecord>();
  let nextSession = 0;
  const pilotSessions = {
    async redeem(inviteCode: string) {
      if (inviteCode !== 'owner-invite') throw new Error('INVITE_INVALID');
      nextSession += 1;
      const token = `owner-session-${nextSession}`;
      sessions.set(token, {
        userId: 'owner-1', role: 'OWNER', displayName: null, expiresAt, revoked: false,
      });
      return { token, expiresAt };
    },
    async authenticate(authorization: string | undefined) {
      const token = authorization?.match(/^Bearer (.+)$/)?.[1];
      const session = token ? sessions.get(token) : undefined;
      if (!session || session.revoked) throw new Error('UNAUTHENTICATED');
      return {
        userId: session.userId,
        role: session.role,
        displayName: session.displayName,
        expiresAt: session.expiresAt,
      };
    },
    async setDisplayName(actor: { userId: string }, displayName: string) {
      const session = [...sessions.values()].find((candidate) => candidate.userId === actor.userId);
      if (!session) throw new Error('UNAUTHENTICATED');
      session.displayName = displayName.trim();
      return { id: session.userId, role: session.role, displayName: session.displayName };
    },
    async revoke(authorization: string | undefined) {
      const token = authorization?.match(/^Bearer (.+)$/)?.[1];
      const session = token ? sessions.get(token) : undefined;
      if (!session || session.revoked) throw new Error('UNAUTHENTICATED');
      session.revoked = true;
    },
  };

  const app = createApp({
    auth: pilotSessions,
    pets: {} as never,
    addresses: {} as never,
    pilot: { config: pilotConfig(nodeEnv), sessions: pilotSessions },
  });
  return { app, sessions };
}

describe('pilot authentication routes', () => {
  it('logs in with an invite and exposes the current cookie-backed session', async () => {
    const { app } = createPilotTestApp();
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/pilot/sessions',
      headers: { origin: productionOrigin },
      payload: { inviteCode: 'owner-invite' },
    });

    expect(login.statusCode).toBe(201);
    expect(login.json()).toEqual({ expiresAt: expiresAt.toISOString() });
    expect(login.headers['set-cookie']).toContain('petcare_pilot_session=owner-session-1');
    expect(login.headers['set-cookie']).toContain('HttpOnly');
    expect(login.headers['set-cookie']).toContain('SameSite=Lax');
    expect(login.headers['set-cookie']).toContain('Secure');
    expect(login.headers['set-cookie']).toContain('Path=/');

    const session = await app.inject({
      method: 'GET',
      url: '/api/v1/pilot/session',
      headers: { cookie: login.headers['set-cookie']! },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({
      userId: 'owner-1', role: 'OWNER', displayName: null, expiresAt: expiresAt.toISOString(),
    });
    await app.close();
  });

  it('updates only the authenticated nickname and persists it in the session view', async () => {
    const { app } = createPilotTestApp('development');
    const login = await app.inject({
      method: 'POST', url: '/api/v1/pilot/sessions', payload: { inviteCode: 'owner-invite' },
    });
    const cookie = login.headers['set-cookie']!;

    const update = await app.inject({
      method: 'PATCH', url: '/api/v1/pilot/me', headers: { cookie },
      payload: { displayName: '  安心宠主  ', role: 'ADMIN' },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toEqual({ id: 'owner-1', role: 'OWNER', displayName: '安心宠主' });

    const session = await app.inject({
      method: 'GET', url: '/api/v1/pilot/session', headers: { cookie },
    });
    expect(session.json()).toMatchObject({ role: 'OWNER', displayName: '安心宠主' });
    expect(login.headers['set-cookie']).not.toContain('Secure');
    await app.close();
  });

  it('revokes the current session and clears the cookie with the same security flags', async () => {
    const { app } = createPilotTestApp();
    const login = await app.inject({
      method: 'POST', url: '/api/v1/pilot/sessions', headers: { origin: productionOrigin },
      payload: { inviteCode: 'owner-invite' },
    });
    const cookie = login.headers['set-cookie']!;

    const logout = await app.inject({
      method: 'DELETE', url: '/api/v1/pilot/session',
      headers: { origin: productionOrigin, cookie },
    });
    expect(logout.statusCode).toBe(204);
    expect(logout.headers['set-cookie']).toContain('petcare_pilot_session=');
    expect(logout.headers['set-cookie']).toContain('HttpOnly');
    expect(logout.headers['set-cookie']).toContain('SameSite=Lax');
    expect(logout.headers['set-cookie']).toContain('Secure');
    expect(logout.headers['set-cookie']).toContain('Path=/');

    const revoked = await app.inject({
      method: 'GET', url: '/api/v1/pilot/session', headers: { cookie },
    });
    expect(revoked.statusCode).toBe(401);
    await app.close();
  });

  it('never lets a cookie override an explicit authorization header', async () => {
    const { app } = createPilotTestApp();
    const login = await app.inject({
      method: 'POST', url: '/api/v1/pilot/sessions', headers: { origin: productionOrigin },
      payload: { inviteCode: 'owner-invite' },
    });
    const response = await app.inject({
      method: 'GET', url: '/api/v1/pilot/session',
      headers: { cookie: login.headers['set-cookie']!, authorization: 'Bearer attacker-token' },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('requires the exact configured Origin for production state changes', async () => {
    const { app } = createPilotTestApp();
    for (const origin of ['https://attacker.example', `${productionOrigin}/`, undefined]) {
      const response = await app.inject({
        method: 'POST', url: '/api/v1/pilot/sessions',
        headers: origin ? { origin } : {},
        payload: { inviteCode: 'owner-invite' },
      });
      expect(response.statusCode).toBe(403);
    }
    await app.close();
  });

  it('guards state-changing pilot routes registered outside the auth plugin', async () => {
    const { app } = createPilotTestApp();
    app.post('/api/v1/pilot/future-write', async () => ({ written: true }));

    const response = await app.inject({
      method: 'POST', url: '/api/v1/pilot/future-write',
      headers: { origin: 'https://attacker.example' },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('allows development state changes without an Origin header', async () => {
    const { app } = createPilotTestApp('development');
    const response = await app.inject({
      method: 'POST', url: '/api/v1/pilot/sessions', payload: { inviteCode: 'owner-invite' },
    });
    expect(response.statusCode).toBe(201);
    await app.close();
  });

  it('rate limits the sixth invalid login attempt and never echoes the invite code', async () => {
    const { app } = createPilotTestApp('development');
    const inviteCode = 'raw-secret-invite-code';
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const response = await app.inject({
        method: 'POST', url: '/api/v1/pilot/sessions', payload: { inviteCode },
      });
      expect(response.statusCode).toBe(attempt <= 5 ? 401 : 429);
      expect(response.body).not.toContain(inviteCode);
    }
    await app.close();
  });
});
