import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthService } from '../auth/auth-service.js';
import type { QuoteService } from '../catalog/quote-service.js';
import type { PaymentService } from '../payments/payment-service.js';
import type { OrderService } from './order-service.js';

const QuoteRequestSchema = z.object({
  serviceType: z.enum(['CAT_FEEDING', 'DOG_WALKING']),
  petIds: z.array(z.uuid()).min(1).max(5),
  addressId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  durationMinutes: z.int().min(15).max(180),
});

const OrderRequestSchema = QuoteRequestSchema.extend({ notes: z.string().max(500) });

export type OrderRoutesDependencies = {
  auth: AuthService;
  quotes: QuoteService;
  orders: OrderService;
  payments: PaymentService;
};

export async function registerOrderRoutes(app: FastifyInstance, deps: OrderRoutesDependencies) {
  const actor = (request: FastifyRequest) => deps.auth.authenticate(request.headers.authorization);
  app.post('/v1/quotes', async (request) => {
    const input = QuoteRequestSchema.parse(request.body);
    return deps.quotes.quote(await actor(request), { ...input, startsAt: new Date(input.startsAt) });
  });
  app.post('/v1/orders', async (request, reply) => {
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 100) {
      throw new Error('VALIDATION_ERROR');
    }
    const input = OrderRequestSchema.parse(request.body);
    const result = await deps.orders.create(await actor(request), {
      ...input, startsAt: new Date(input.startsAt), idempotencyKey: key,
    });
    return reply.code(result.replay ? 200 : 201).send({
      id: result.order.id,
      status: result.order.status,
      totalFen: result.order.totalFen,
      currency: result.order.currency,
      paymentToken: result.paymentToken,
    });
  });
  app.post('/v1/payments/webhooks/fake', async (request) => deps.payments.handleWebhook(
    request.body, request.headers['x-payment-signature'] as string | undefined,
  ));
}
