import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthService } from '../auth/auth-service.js';
import type { RefundService } from '../payments/refund-service.js';
import type { SettlementService } from '../payments/settlement-service.js';
import type { DisputeService } from './dispute-service.js';

export type DisputeRoutesDependencies = {
  auth: AuthService;
  settlements: SettlementService;
  refunds: RefundService;
  disputes: DisputeService;
};

export async function registerDisputeRoutes(app: FastifyInstance, deps: DisputeRoutesDependencies) {
  const actor = (request: FastifyRequest) => deps.auth.authenticate(request.headers.authorization);
  app.post<{ Params: { orderId: string } }>('/v1/orders/:orderId/confirm', async (request) => {
    const confirmedAt = new Date();
    const settlement = await deps.settlements.confirmOrder(
      await actor(request), request.params.orderId, confirmedAt,
    );
    if (!settlement) throw new Error('CONFIRMATION_NOT_ALLOWED');
    return {
      orderId: settlement.orderId,
      status: 'COMPLETED' as const,
      confirmedAt: settlement.availableAt.toISOString(),
    };
  });
  app.post<{ Params: { orderId: string } }>('/v1/orders/:orderId/cancel', async (request) => {
    const input = z.object({ reason: z.string().trim().min(1).max(500) }).parse(request.body);
    return deps.refunds.requestCancellation(await actor(request), request.params.orderId, input.reason);
  });
  app.post<{ Params: { orderId: string } }>('/v1/orders/:orderId/disputes', async (request, reply) => {
    const input = z.object({ reason: z.string().trim().min(1).max(1000) }).parse(request.body);
    const dispute = await deps.disputes.openDispute(await actor(request), request.params.orderId, input.reason);
    return reply.code(201).send(dispute);
  });
  app.post<{ Params: { disputeId: string } }>('/v1/disputes/:disputeId/resolve', async (request) => {
    const input = z.object({ refundFen: z.int().min(0), resolution: z.string().trim().min(1).max(1000) })
      .parse(request.body);
    return deps.disputes.resolveDispute(await actor(request), request.params.disputeId, input);
  });
}
