import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthService, ActorContext } from '../auth/auth-service.js';
import type { PilotInviteRole } from '../auth/pilot-session-service.js';
import type { FulfillmentService } from '../fulfillment/fulfillment-service.js';
import type { ManualFeeService } from './manual-fee-service.js';
import type { PilotReadModel } from './pilot-read-model.js';

const JsonObjectSchema = z.record(z.string(), z.unknown());
const InviteSchema = z.object({ role: z.enum(['OWNER', 'PROVIDER']) });
const CheckInSchema = z.object({ beforeState: JsonObjectSchema });
const ReportSchema = z.object({
  checklist: JsonObjectSchema,
  afterState: JsonObjectSchema,
  notes: z.string().max(1000),
});

type PilotInviteCreator = {
  createInvite(actor: ActorContext, role: PilotInviteRole): Promise<unknown>;
};

export type PilotRoutesDependencies = {
  auth: AuthService;
  fees: Pick<ManualFeeService, 'confirm'>;
  read: Pick<PilotReadModel, 'dashboard' | 'orders' | 'order' | 'reviewQueue' | 'invites'>;
  sessions: PilotInviteCreator;
  fulfillment: Pick<FulfillmentService, 'checkIn' | 'submitReport'>;
  now?: () => Date;
};

export async function registerPilotRoutes(
  app: FastifyInstance,
  dependencies: PilotRoutesDependencies,
): Promise<void> {
  const actor = (request: FastifyRequest) => (
    dependencies.auth.authenticate(request.headers.authorization)
  );
  const now = dependencies.now ?? (() => new Date());

  app.post('/api/v1/pilot/invites', async (request, reply) => {
    const input = InviteSchema.parse(request.body);
    const result = await dependencies.sessions.createInvite(await actor(request), input.role);
    return reply.code(201).send(result);
  });

  app.post<{ Params: { orderId: string } }>(
    '/api/v1/pilot/orders/:orderId/manual-fee-confirmation',
    async (request) => {
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string') throw new Error('VALIDATION_ERROR');
      return dependencies.fees.confirm(await actor(request), request.params.orderId, key);
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
    async (request) => dependencies.read.order(await actor(request), request.params.orderId),
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
      const input = CheckInSchema.parse(request.body);
      const result = await dependencies.fulfillment.checkIn(
        await actor(request), request.params.orderId, now(), input.beforeState,
      );
      return reply.code(201).send(result);
    },
  );

  app.post<{ Params: { orderId: string } }>(
    '/api/v1/pilot/orders/:orderId/report',
    async (request) => {
      const input = ReportSchema.parse(request.body);
      return dependencies.fulfillment.submitReport(
        await actor(request),
        request.params.orderId,
        { ...input, checkedOutAt: now() },
      );
    },
  );
}
