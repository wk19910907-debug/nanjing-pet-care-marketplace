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

function pilotConfig(
  nodeEnv: 'development' | 'production',
  trustedProxies?: string[],
): AppConfig {
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
      ...(trustedProxies ? { trustedProxies } : {}),
      secureCookies: nodeEnv === 'production',
    },
  };
}

function createPilotTestApp(
  nodeEnv: 'development' | 'production' = 'production',
  trustedProxies?: string[],
) {
  const sessions = new Map<string, SessionRecord>();
  const localSessionRoles: Array<'OWNER' | 'PROVIDER' | 'ADMIN'> = [];
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
    async createInvite() {
      throw new Error('FORBIDDEN');
    },
    localSessionRoles,
    async createLocalSession(
      this: { localSessionRoles: Array<'OWNER' | 'PROVIDER' | 'ADMIN'> },
      role: 'OWNER' | 'PROVIDER' | 'ADMIN',
    ) {
      this.localSessionRoles.push(role);
      return { token: `local-${role.toLowerCase()}-session`, expiresAt };
    },
  };

  const app = createApp({
    auth: pilotSessions,
    pets: {} as never,
    addresses: {} as never,
    pilot: { config: pilotConfig(nodeEnv, trustedProxies), sessions: pilotSessions },
  });
  return { app, sessions, pilotSessions, localSessionRoles };
}

describe('pilot authentication routes', () => {
  it.each(['OWNER', 'PROVIDER', 'ADMIN'] as const)(
    'creates a local %s session with the existing cookie contract',
    async (role) => {
      const { app, localSessionRoles } = createPilotTestApp('development');

      const response = await app.inject({
        method: 'POST', url: '/api/v1/pilot/local-sessions', payload: { role },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ expiresAt: expiresAt.toISOString() });
      expect(response.headers['set-cookie']).toContain(`petcare_pilot_session=local-${role.toLowerCase()}-session`);
      expect(response.headers['set-cookie']).toContain('HttpOnly');
      expect(response.headers['set-cookie']).toContain('SameSite=Lax');
      expect(response.headers['set-cookie']).toContain('Path=/');
      expect(response.headers['set-cookie']).not.toContain('Secure');
      expect(localSessionRoles).toEqual([role]);
      await app.close();
    },
  );

  it('rejects malformed local session role bodies before invoking the service', async () => {
    const { app, localSessionRoles } = createPilotTestApp('development');

    for (const payload of [{}, { role: 'ROOT' }, { role: 'OWNER', extra: true }]) {
      const response = await app.inject({
        method: 'POST', url: '/api/v1/pilot/local-sessions', payload,
      });
      expect(response.statusCode).toBe(400);
    }

    expect(localSessionRoles).toEqual([]);
    await app.close();
  });

  it('rejects non-loopback local session requests without invoking the service', async () => {
    const { app, localSessionRoles } = createPilotTestApp('development');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pilot/local-sessions',
      remoteAddress: '203.0.113.20',
      payload: { role: 'ADMIN' },
    });

    expect(response.statusCode).toBe(403);
    expect(localSessionRoles).toEqual([]);
    await app.close();
  });

  it.each(['::1', '::ffff:127.0.0.1'])(
    'accepts the loopback address %s for local sessions',
    async (remoteAddress) => {
      const { app, localSessionRoles } = createPilotTestApp('development');

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/pilot/local-sessions',
        remoteAddress,
        payload: { role: 'OWNER' },
      });

      expect(response.statusCode).toBe(201);
      expect(localSessionRoles).toEqual(['OWNER']);
      await app.close();
    },
  );

  it('rejects a forwarded external address from a trusted loopback proxy', async () => {
    const { app, localSessionRoles } = createPilotTestApp('development', ['127.0.0.1/32']);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pilot/local-sessions',
      headers: { 'x-forwarded-for': '203.0.113.20' },
      payload: { role: 'OWNER' },
    });

    expect(response.statusCode).toBe(403);
    expect(localSessionRoles).toEqual([]);
    await app.close();
  });

  it('does not let an untrusted peer spoof a loopback address through forwarding headers', async () => {
    const { app, localSessionRoles } = createPilotTestApp('development', ['10.0.0.0/8']);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pilot/local-sessions',
      remoteAddress: '203.0.113.20',
      headers: { 'x-forwarded-for': '127.0.0.1' },
      payload: { role: 'OWNER' },
    });

    expect(response.statusCode).toBe(403);
    expect(localSessionRoles).toEqual([]);
    await app.close();
  });

  it('does not register local session access in production', async () => {
    const { app, localSessionRoles } = createPilotTestApp('production');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pilot/local-sessions',
      headers: { origin: productionOrigin },
      payload: { role: 'OWNER' },
    });

    expect(response.statusCode).toBe(404);
    expect(localSessionRoles).toEqual([]);
    await app.close();
  });

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

  it('counts only failed invite redemptions toward the login limit', async () => {
    const { app } = createPilotTestApp('development');

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const success = await app.inject({
        method: 'POST', url: '/api/v1/pilot/sessions', payload: { inviteCode: 'owner-invite' },
      });
      expect(success.statusCode).toBe(201);
    }

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const malformed = await app.inject({
        method: 'POST', url: '/api/v1/pilot/sessions', payload: { inviteCode: '' },
      });
      expect(malformed.statusCode).toBe(400);
    }

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const invalid = await app.inject({
        method: 'POST', url: '/api/v1/pilot/sessions', payload: { inviteCode: 'invalid-invite' },
      });
      expect(invalid.statusCode).toBe(attempt <= 5 ? 401 : 429);
    }
    await app.close();
  });

  it('admits at most five concurrent invalid redemptions for one client', async () => {
    const { app, pilotSessions } = createPilotTestApp('development');
    await app.ready();
    let redeemCalls = 0;
    let releaseRedemptions!: () => void;
    let signalFirstRedemption!: () => void;
    const redemptionsReleased = new Promise<void>((resolve) => { releaseRedemptions = resolve; });
    const firstRedemption = new Promise<void>((resolve) => { signalFirstRedemption = resolve; });
    pilotSessions.redeem = async () => {
      redeemCalls += 1;
      signalFirstRedemption();
      await redemptionsReleased;
      throw new Error('INVITE_INVALID');
    };

    const pending = Array.from({ length: 10 }, () => app.inject({
      method: 'POST', url: '/api/v1/pilot/sessions', payload: { inviteCode: 'invalid-invite' },
    }));
    await firstRedemption;
    for (let turn = 0; turn < 3; turn += 1) {
      await new Promise<void>((resolve) => { setImmediate(resolve); });
    }
    const callsBeforeRelease = redeemCalls;
    releaseRedemptions();
    const responses = await Promise.all(pending);

    expect(callsBeforeRelease).toBe(1);
    expect(redeemCalls).toBe(5);
    expect(responses.filter((response) => response.statusCode === 401)).toHaveLength(5);
    expect(responses.filter((response) => response.statusCode === 429)).toHaveLength(5);
    await app.close();
  });

  it('partitions failed-login budgets by client behind an explicitly trusted proxy', async () => {
    const { app } = createPilotTestApp('development', ['127.0.0.1/32']);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: 'POST', url: '/api/v1/pilot/sessions',
        headers: { 'x-forwarded-for': '203.0.113.10' },
        payload: { inviteCode: 'invalid-invite' },
      });
      expect(response.statusCode).toBe(401);
    }

    const otherClient = await app.inject({
      method: 'POST', url: '/api/v1/pilot/sessions',
      headers: { 'x-forwarded-for': '203.0.113.11' },
      payload: { inviteCode: 'invalid-invite' },
    });
    expect(otherClient.statusCode).toBe(401);

    const limitedClient = await app.inject({
      method: 'POST', url: '/api/v1/pilot/sessions',
      headers: { 'x-forwarded-for': '203.0.113.10' },
      payload: { inviteCode: 'invalid-invite' },
    });
    expect(limitedClient.statusCode).toBe(429);
    await app.close();
  });

  it('ignores spoofed forwarding headers from an untrusted direct peer', async () => {
    const { app } = createPilotTestApp('development', ['10.0.0.0/8']);
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const response = await app.inject({
        method: 'POST', url: '/api/v1/pilot/sessions',
        headers: { 'x-forwarded-for': `203.0.113.${attempt}` },
        payload: { inviteCode: 'invalid-invite' },
      });
      expect(response.statusCode).toBe(attempt <= 5 ? 401 : 429);
    }
    await app.close();
  });

  it.each(['redeem', 'authenticate', 'setDisplayName', 'revoke'] as const)
  ('returns a fixed safe 503 when %s has an unexpected operational failure', async (operation) => {
    const { app, pilotSessions } = createPilotTestApp('development');
    const internalDetail = `postgresql://internal/${operation}?token=secret`;
    let cookie: string | undefined;

    if (operation !== 'redeem') {
      const login = await app.inject({
        method: 'POST', url: '/api/v1/pilot/sessions', payload: { inviteCode: 'owner-invite' },
      });
      const setCookie = login.headers['set-cookie'];
      cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    }

    if (operation === 'redeem') {
      pilotSessions.redeem = async () => { throw new Error(internalDetail); };
    } else if (operation === 'authenticate') {
      pilotSessions.authenticate = async () => { throw new Error(internalDetail); };
    } else if (operation === 'setDisplayName') {
      pilotSessions.setDisplayName = async () => { throw new Error(internalDetail); };
    } else {
      pilotSessions.revoke = async () => { throw new Error(internalDetail); };
    }

    const response = operation === 'redeem'
      ? await app.inject({
        method: 'POST', url: '/api/v1/pilot/sessions', payload: { inviteCode: 'owner-invite' },
      })
      : operation === 'authenticate'
        ? await app.inject({ method: 'GET', url: '/api/v1/pilot/session', headers: { cookie } })
        : operation === 'setDisplayName'
          ? await app.inject({
            method: 'PATCH', url: '/api/v1/pilot/me', headers: { cookie },
            payload: { displayName: '安心宠主' },
          })
          : await app.inject({ method: 'DELETE', url: '/api/v1/pilot/session', headers: { cookie } });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ code: 'SERVICE_UNAVAILABLE' });
    expect(response.body).not.toContain(internalDetail);
    expect(response.body).not.toContain('postgresql://');
    await app.close();
  });

  it.each([
    {
      label: 'malformed JSON', contentType: 'application/json', payload: '{"inviteCode":',
      statusCode: 400, code: 'FST_ERR_CTP_INVALID_JSON_BODY',
    },
    {
      label: 'unsupported content type', contentType: 'application/xml', payload: '<invite />',
      statusCode: 415, code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE',
    },
    {
      label: 'oversized body', contentType: 'application/json',
      payload: JSON.stringify({ inviteCode: 'x'.repeat(1_048_576) }),
      statusCode: 413, code: 'FST_ERR_CTP_BODY_TOO_LARGE',
    },
  ])('preserves a safe framework 4xx response for $label', async ({
    contentType, payload, statusCode, code,
  }) => {
    const { app } = createPilotTestApp('development');
    const response = await app.inject({
      method: 'POST', url: '/api/v1/pilot/sessions',
      headers: { 'content-type': contentType }, payload,
    });

    expect(response.statusCode).toBe(statusCode);
    expect(response.json()).toEqual({ code });
    expect(response.body).not.toContain(payload.slice(0, 32));
    await app.close();
  });
});
