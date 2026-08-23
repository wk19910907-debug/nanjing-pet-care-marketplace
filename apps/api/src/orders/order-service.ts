import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { ActorContext } from '../auth/auth-service.js';
import { authorizeRole } from '../auth/authorize.js';
import type { AuditRepository } from '../audit/audit-repository.js';
import type { QuoteRequest, QuoteService } from '../catalog/quote-service.js';
import type { PaymentGateway } from '../payments/payment-gateway.js';

export type CreateOrderRequest = QuoteRequest & { notes: string; idempotencyKey: string };

export class OrderService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly quotes: QuoteService,
    private readonly gateway: PaymentGateway,
    private readonly audit: AuditRepository,
  ) {}

  public async create(actor: ActorContext, request: CreateOrderRequest) {
    authorizeRole(actor, ['OWNER']);
    const existing = await this.prisma.order.findUnique({
      where: { idempotencyKey_ownerId: {
        idempotencyKey: request.idempotencyKey, ownerId: actor.userId,
      }},
      include: { payment: true },
    });
    if (existing) return { order: existing, paymentToken: existing.payment?.providerPaymentId, replay: true };

    const quote = await this.quotes.quote(actor, request);
    const orderId = randomUUID();
    const createdPayment = await this.gateway.createPayment({
      orderId, amountFen: quote.totalFen, currency: 'CNY',
    });
    const order = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.order.create({
        data: {
          id: orderId,
          ownerId: actor.userId,
          addressId: request.addressId,
          idempotencyKey: request.idempotencyKey,
          serviceType: request.serviceType,
          startsAt: request.startsAt,
          durationMinutes: request.durationMinutes,
          notes: request.notes,
          quoteSnapshot: quote as Prisma.InputJsonValue,
          totalFen: quote.totalFen,
          pets: { create: request.petIds.map((petId) => ({ petId })) },
          payment: { create: {
            provider: this.gateway.providerName,
            providerPaymentId: createdPayment.providerPaymentId,
            providerEventId: null,
            amountFen: quote.totalFen,
          }},
        },
        include: { payment: true },
      });
      await this.audit.append({
        actorId: actor.userId, actorRole: actor.role, action: 'ORDER_CREATED',
        entityType: 'Order', entityId: saved.id,
        metadata: { totalFen: saved.totalFen, serviceType: saved.serviceType },
      }, tx);
      return saved;
    });
    return { order, paymentToken: createdPayment.paymentToken, replay: false };
  }
}
