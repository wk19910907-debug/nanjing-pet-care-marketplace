import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export const WECHAT_SESSION_PATH = '/api/v1/auth/wechat/session';
export type WechatLoginService = {
  login(code: string): Promise<{ token: string; expiresAt: Date }>;
};
const LoginSchema = z.object({ code: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/) }).strict();

export async function registerWechatLoginRoutes(
  app: FastifyInstance,
  dependencies: { wechatLogin?: WechatLoginService; publicOrigin?: string },
): Promise<void> {
  // Per process only. Production must also rate-limit at the trusted ingress.
  const attempts = new Map<string, { count: number; until: number }>();
  let inFlight = 0;
  app.post(WECHAT_SESSION_PATH, {
    bodyLimit: 2_048,
    onRequest: async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (request.headers.cookie !== undefined || request.headers.authorization !== undefined
        || (request.headers.origin !== undefined && request.headers.origin !== dependencies.publicOrigin)) {
        return reply.code(403).send({ code: 'FORBIDDEN' });
      }
      const now = Date.now();
      // Map order follows insertion/expiry, so cleanup is amortized and bounded.
      for (const [key, value] of attempts) {
        if (value.until > now) break;
        attempts.delete(key);
      }
      const previous = attempts.get(request.ip);
      if ((previous?.count ?? 0) >= 10 || (!previous && attempts.size >= 10_000) || inFlight >= 32) {
        return reply.code(429).header('Retry-After', '60').send({ code: 'LOGIN_RATE_LIMITED' });
      }
      attempts.set(request.ip, { count: (previous?.count ?? 0) + 1, until: previous?.until ?? now + 60_000 });
    },
  }, async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (!dependencies.wechatLogin) return reply.code(503).send({ code: 'WECHAT_LOGIN_UNAVAILABLE' });
    // Check again after parsing, before starting network/database work.
    if (inFlight >= 32) return reply.code(429).header('Retry-After', '60').send({ code: 'LOGIN_RATE_LIMITED' });
    inFlight += 1;
    try {
      const session = await dependencies.wechatLogin.login(parsed.data.code);
      return reply.code(201).send({ token: session.token, expiresAt: session.expiresAt.toISOString() });
    } catch (error) {
      if (error instanceof Error && error.message === 'WECHAT_CODE_INVALID') {
        return reply.code(401).send({ code: 'WECHAT_CODE_INVALID' });
      }
      if (error instanceof Error && error.message === 'FORBIDDEN') {
        return reply.code(403).send({ code: 'FORBIDDEN' });
      }
      return reply.code(503).send({ code: 'WECHAT_LOGIN_UNAVAILABLE' });
    } finally { inFlight -= 1; }
  });
}
