import cookie, { type FastifyCookieOptions } from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { FailedLoginLimiter } from './failed-login-limiter.js';
import type { PilotSessionService } from './pilot-session-service.js';

const SESSION_COOKIE = 'petcare_pilot_session';
const LoginSchema = z.object({ inviteCode: z.string().min(1).max(512) });
const DisplayNameSchema = z.object({ displayName: z.string() });

type PilotRouteSessions = Pick<
  PilotSessionService,
  'redeem' | 'authenticate' | 'setDisplayName' | 'revoke'
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
