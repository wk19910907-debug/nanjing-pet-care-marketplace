import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthService } from '../auth/auth-service.js';
import type { OrderConversationService } from './order-conversation-service.js';

const ORDER_PARAMS = z.object({ orderId: z.uuid() });
const LIST_QUERY = z.object({ cursor: z.string().min(1).max(512).optional() }).strict();
const MESSAGE_BODY = z.object({ body: z.string() }).strict();
const MESSAGE_BODY_LIMIT = 2 * 1024;

export type OrderConversationRoutesDependencies = {
  auth: AuthService;
  conversations: Pick<OrderConversationService, 'list' | 'send'>;
};

export async function registerOrderConversationRoutes(
  app: FastifyInstance,
  dependencies: OrderConversationRoutesDependencies,
): Promise<void> {
  const actor = (request: FastifyRequest) => dependencies.auth.authenticate(request.headers.authorization);

  app.get<{ Params: { orderId: string }; Querystring: { cursor?: string } }>(
    '/api/v1/pilot/orders/:orderId/messages',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { orderId } = ORDER_PARAMS.parse(request.params);
      const { cursor } = LIST_QUERY.parse(request.query);
      return dependencies.conversations.list(await actor(request), orderId, cursor);
    },
  );

  app.post<{ Params: { orderId: string } }>(
    '/api/v1/pilot/orders/:orderId/messages',
    { bodyLimit: MESSAGE_BODY_LIMIT },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { orderId } = ORDER_PARAMS.parse(request.params);
      const { body } = MESSAGE_BODY.parse(request.body);
      const message = await dependencies.conversations.send(await actor(request), orderId, body);
      return reply.code(201).send(message);
    },
  );
}
