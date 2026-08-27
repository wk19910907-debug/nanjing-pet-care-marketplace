import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { PilotSessionService } from '../auth/pilot-session-service.js';
import type { FulfillmentService } from '../fulfillment/fulfillment-service.js';
import type { ManualFeeService } from './manual-fee-service.js';
import type { PilotReadModel } from './pilot-read-model.js';

const JsonObjectSchema = z.record(z.string(), z.unknown());
const InviteSchema = z.object({ role: z.enum(['OWNER', 'PROVIDER']) });
const OrderParamsSchema = z.object({ orderId: z.uuid() });
const CheckInSchema = z.object({ beforeState: JsonObjectSchema });
const ReportSchema = z.object({
  checklist: JsonObjectSchema,
  afterState: JsonObjectSchema,
  notes: z.string().max(1000),
});

export type PilotBusinessSessions = Pick<PilotSessionService, 'authenticate' | 'createInvite'>;

export type PilotRoutesDependencies = {
  fees: Pick<ManualFeeService, 'confirm'>;
  read: Pick<PilotReadModel, 'dashboard' | 'orders' | 'order' | 'reviewQueue' | 'invites'>;
  sessions: PilotBusinessSessions;
  fulfillment: Pick<FulfillmentService, 'checkIn' | 'submitReport'>;
  now?: () => Date;
};

export async function registerPilotRoutes(
  app: FastifyInstance,
  dependencies: PilotRoutesDependencies,
): Promise<void> {
  const actor = async (request: FastifyRequest) => {
    const session = await dependencies.sessions.authenticate(request.headers.authorization);
    if (session.displayName === null) throw new Error('ONBOARDING_REQUIRED');
    return session;
  };
  const now = dependencies.now ?? (() => new Date());

  app.post('/api/v1/pilot/invites', async (request, reply) => {
    const current = await actor(request);
    const input = InviteSchema.parse(request.body);
    const result = await dependencies.sessions.createInvite(current, input.role);
    return reply.code(201).send(result);
  });

  app.post<{ Params: { orderId: string } }>(
    '/api/v1/pilot/orders/:orderId/manual-fee-confirmation',
    async (request) => {
      const current = await actor(request);
      const { orderId } = OrderParamsSchema.parse(request.params);
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string') throw new Error('VALIDATION_ERROR');
      return dependencies.fees.confirm(current, orderId, key);
    },
  );

  app.get('/api/v1/pilot/dashboard', async (request) => (
    dependencies.read.dashboard(await actor(request))
  ));

  app.get('/api/v1/pilot/orders', async (request) => (
    dependencies.read.orders(await actor(request))
  ));

  app.get<{ Params: { orderId: string } }>(
    '/api/v1/pilot/orders/:orderId',
    async (request) => {
      const current = await actor(request);
      const { orderId } = OrderParamsSchema.parse(request.params);
      return dependencies.read.order(current, orderId);
    },
  );

  app.get('/api/v1/pilot/providers/review-queue', async (request) => (
    dependencies.read.reviewQueue(await actor(request))
  ));

  app.get('/api/v1/pilot/invites', async (request) => (
    dependencies.read.invites(await actor(request))
  ));

  app.post<{ Params: { orderId: string } }>(
    '/api/v1/pilot/orders/:orderId/check-in',
    async (request, reply) => {
      const current = await actor(request);
      const { orderId } = OrderParamsSchema.parse(request.params);
      const input = CheckInSchema.parse(request.body);
      const result = await dependencies.fulfillment.checkIn(
        current, orderId, now(), input.beforeState,
      );
      return reply.code(201).send(result);
    },
  );

  app.post<{ Params: { orderId: string } }>(
    '/api/v1/pilot/orders/:orderId/report',
    async (request) => {
      const current = await actor(request);
      const { orderId } = OrderParamsSchema.parse(request.params);
      const input = ReportSchema.parse(request.body);
      return dependencies.fulfillment.submitReport(
        current,
        orderId,
        { ...input, checkedOutAt: now() },
      );
    },
  );
}
