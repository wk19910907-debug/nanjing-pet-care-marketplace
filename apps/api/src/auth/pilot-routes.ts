import cookie, { type FastifyCookieOptions } from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { FailedLoginLimiter } from './failed-login-limiter.js';
import {
  LOCAL_PILOT_ROLES,
  type PilotSessionService,
} from './pilot-session-service.js';

const SESSION_COOKIE = 'petcare_pilot_session';
const LoginSchema = z.object({ inviteCode: z.string().min(1).max(512) });
const DisplayNameSchema = z.object({ displayName: z.string() });
const LocalSessionSchema = z.object({ role: z.enum(LOCAL_PILOT_ROLES) }).strict();
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isAllowedLocalSessionRequest(request: FastifyRequest, config: AppConfig): boolean {
  const pilot = config.pilot;
  if (!pilot || !LOOPBACK_ADDRESSES.has(pilot.host)) return false;

  const authorityHost = pilot.host.includes(':') ? `[${pilot.host}]` : pilot.host;
  const authority = `${authorityHost}:${pilot.port}`;
  const origin = `http://${authority}`;
  const transportPeer = request.raw.socket.remoteAddress;

  return transportPeer !== undefined
    && LOOPBACK_ADDRESSES.has(transportPeer)
    && LOOPBACK_ADDRESSES.has(request.ip)
    && request.raw.headers.host === authority
    && (request.headers.origin === undefined || request.headers.origin === origin);
}

type PilotRouteSessions = Pick<
  PilotSessionService,
  'redeem' | 'authenticate' | 'setDisplayName' | 'revoke' | 'createInvite' | 'createLocalSession'
>;

export type PilotAuthRoutesDependencies = {
  config: AppConfig;
  sessions: PilotRouteSessions;
};

function cookieOptions(secure: boolean): FastifyCookieOptions['parseOptions'] {
  return { httpOnly: true, sameSite: 'lax', path: '/', secure };
}

function writeSessionCookie(
  reply: FastifyReply,
  secure: boolean,
  session?: { token: string; expiresAt: Date },
): void {
  const options = cookieOptions(secure);
  if (session) reply.setCookie(SESSION_COOKIE, session.token, { ...options, expires: session.expiresAt });
  else reply.clearCookie(SESSION_COOKIE, options);
}

export function installPilotCookieBridge(app: FastifyInstance): void {
  void app.register(cookie);
  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token && !request.headers.authorization) request.headers.authorization = `Bearer ${token}`;
  });
}

export async function registerPilotAuthRoutes(
  app: FastifyInstance,
  dependencies: PilotAuthRoutesDependencies,
): Promise<void> {
  const authorization = (request: FastifyRequest) => request.headers.authorization;
  const secureCookies = dependencies.config.pilot?.secureCookies ?? false;
  const failedLogins = new FailedLoginLimiter(5, 10 * 60 * 1_000);

  app.post('/api/v1/pilot/sessions', async (request, reply) => {
    const { inviteCode } = LoginSchema.parse(request.body);
    const clientKey = request.ip;
    const session = await failedLogins.attempt(
      clientKey,
      () => dependencies.sessions.redeem(inviteCode),
    );
    writeSessionCookie(reply, secureCookies, session);
    return reply.code(201).send({ expiresAt: session.expiresAt.toISOString() });
  });

  if (dependencies.config.nodeEnv === 'development' || dependencies.config.nodeEnv === 'test') {
    app.post('/api/v1/pilot/local-sessions', {
      onRequest: async (request, reply) => {
        if (!isAllowedLocalSessionRequest(request, dependencies.config)) {
          return reply.code(403).send({ code: 'FORBIDDEN' });
        }
      },
    }, async (request, reply) => {
      const { role } = LocalSessionSchema.parse(request.body);
      const session = await dependencies.sessions.createLocalSession(role);
      writeSessionCookie(reply, secureCookies, session);
      return reply.code(201).send({ expiresAt: session.expiresAt.toISOString() });
    });
  }

  app.get('/api/v1/pilot/session', async (request) => (
    dependencies.sessions.authenticate(authorization(request))
  ));

  app.patch('/api/v1/pilot/me', async (request) => {
    const actor = await dependencies.sessions.authenticate(authorization(request));
    const { displayName } = DisplayNameSchema.parse(request.body);
    return dependencies.sessions.setDisplayName(actor, displayName);
  });

  app.delete('/api/v1/pilot/session', async (request, reply) => {
    await dependencies.sessions.revoke(authorization(request));
    writeSessionCookie(reply, secureCookies);
    return reply.code(204).send();
  });
}
