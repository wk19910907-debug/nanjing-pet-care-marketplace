import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { PublicOwnerAccessService } from './public-owner-access-service.js';
import { writeSessionCookie } from './pilot-routes.js';
import type { PilotSessionService } from './pilot-session-service.js';
import type { StaffCredentialService } from './staff-credential-service.js';
import { authenticateStaffAction } from './staff-action-auth.js';

const EMPTY_BODY = z.object({}).strict();
const RECOVERY_SESSION = z.object({ token: z.string().min(1).max(256) }).strict();
const STAFF_LOGIN = z.object({ username: z.string().min(1).max(256), password: z.string().min(1).max(128) }).strict();
const PASSWORD = z.object({ password: z.string().min(12).max(128) }).strict();
const CREATE_PROVIDER = z.object({ username: z.string().min(1).max(64), displayName: z.string().min(1).max(30), temporaryPassword: z.string().min(12).max(128) }).strict();
const DISABLE = z.object({ disabled: z.boolean() }).strict();
const RESET_PASSWORD = z.object({ temporaryPassword: z.string().min(12).max(128) }).strict();
const USER_ID = z.string().uuid();
const SMALL_BODY_LIMIT = 2 * 1024;

export type ProductionAccessRoutesDependencies = {
  config: AppConfig;
  sessions: Pick<PilotSessionService, 'authenticate'>;
  publicOwnerAccess: Pick<PublicOwnerAccessService, 'ensureOwnerSession' | 'issueRecovery' | 'rotateRecovery' | 'recover'>;
  staffCredentials: Pick<StaffCredentialService, 'login' | 'changePassword' | 'list' | 'createProvider' | 'setDisabled' | 'resetPassword'>;
};

function sessionResponse(session: { expiresAt: Date }, extra: Record<string, unknown> = {}) {
  return { expiresAt: session.expiresAt.toISOString(), ...extra };
}

function auth(request: FastifyRequest) { return request.headers.authorization; }

function requestAbort(request: FastifyRequest, reply: FastifyReply): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const responseClose = () => { if (!reply.raw.writableEnded) abort(); };
  if (request.raw.aborted) abort();
  else request.raw.once('aborted', abort);
  reply.raw.once('close', responseClose);
  return { signal: controller.signal, dispose: () => {
    request.raw.removeListener('aborted', abort);
    reply.raw.removeListener('close', responseClose);
  } };
}

/** Cookie-only browser entry points; every route is intentionally non-cacheable. */
export async function registerProductionAccessRoutes(app: FastifyInstance, dependencies: ProductionAccessRoutesDependencies): Promise<void> {
  const secureCookies = dependencies.config.nodeEnv === 'production' || dependencies.config.pilot?.secureCookies === true;
  await app.register(rateLimit, { global: false });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    return payload;
  });

  app.post('/api/v1/public/owner-sessions', { bodyLimit: SMALL_BODY_LIMIT, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    EMPTY_BODY.parse(request.body === undefined ? {} : request.body);
    const lifecycle = requestAbort(request, reply);
    let result;
    try { result = await dependencies.publicOwnerAccess.ensureOwnerSession(auth(request), lifecycle.signal); }
    finally { lifecycle.dispose(); }
    if (result.session) writeSessionCookie(reply, secureCookies, result.session);
    return reply.code(result.created ? 201 : 200).send(sessionResponse(result));
  });
  app.post('/api/v1/public/owner-recovery-credentials', { bodyLimit: SMALL_BODY_LIMIT, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    EMPTY_BODY.parse(request.body === undefined ? {} : request.body);
    const result = await dependencies.publicOwnerAccess.issueRecovery(await dependencies.sessions.authenticate(auth(request)));
    return reply.code(201).send(result);
  });
  app.post('/api/v1/public/owner-recovery-credentials/rotate', { bodyLimit: SMALL_BODY_LIMIT, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    EMPTY_BODY.parse(request.body === undefined ? {} : request.body);
    return reply.send(await dependencies.publicOwnerAccess.rotateRecovery(await dependencies.sessions.authenticate(auth(request))));
  });
  app.post('/api/v1/public/owner-recovery-sessions', { bodyLimit: SMALL_BODY_LIMIT, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { token } = RECOVERY_SESSION.parse(request.body);
    const session = await dependencies.publicOwnerAccess.recover(token);
    writeSessionCookie(reply, secureCookies, session);
    return reply.code(201).send(sessionResponse(session));
  });
  app.post('/api/v1/staff/sessions', { bodyLimit: SMALL_BODY_LIMIT, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { username, password } = STAFF_LOGIN.parse(request.body);
    const result = await dependencies.staffCredentials.login(username, password, request.ip);
    writeSessionCookie(reply, secureCookies, result.session);
    return reply.code(201).send(sessionResponse(result.session, { mustChangePassword: result.mustChangePassword }));
  });
  app.patch('/api/v1/staff/password', { bodyLimit: SMALL_BODY_LIMIT }, async (request, reply) => {
    const { password } = PASSWORD.parse(request.body);
    const sessionActor = await dependencies.sessions.authenticate(auth(request));
    const result = await dependencies.staffCredentials.changePassword({
      ...sessionActor, staffPasswordChangedAt: sessionActor.staffPasswordChangedAt ?? null,
    }, password);
    writeSessionCookie(reply, secureCookies, result.session);
    return reply.send(sessionResponse(result.session, { mustChangePassword: false }));
  });
  const staffAction = (request: FastifyRequest) => authenticateStaffAction(
    dependencies.sessions.authenticate.bind(dependencies.sessions), auth(request),
  );
  app.get('/api/v1/admin/staff-accounts', async (request) => dependencies.staffCredentials.list(await staffAction(request)));
  app.post('/api/v1/admin/staff-accounts', { bodyLimit: SMALL_BODY_LIMIT }, async (request, reply) => {
    const input = CREATE_PROVIDER.parse(request.body);
    return reply.code(201).send(await dependencies.staffCredentials.createProvider(await staffAction(request), input));
  });
  app.patch<{ Params: { userId: string } }>('/api/v1/admin/staff-accounts/:userId', { bodyLimit: SMALL_BODY_LIMIT }, async (request) => {
    const userId = USER_ID.parse(request.params.userId);
    const { disabled } = DISABLE.parse(request.body);
    return dependencies.staffCredentials.setDisabled(await staffAction(request), userId, disabled);
  });
  app.post<{ Params: { userId: string } }>('/api/v1/admin/staff-accounts/:userId/reset-password', { bodyLimit: SMALL_BODY_LIMIT }, async (request, reply) => {
    const userId = USER_ID.parse(request.params.userId);
    const { temporaryPassword } = RESET_PASSWORD.parse(request.body);
    await dependencies.staffCredentials.resetPassword(await staffAction(request), userId, temporaryPassword);
    return reply.code(204).send();
  });
}
