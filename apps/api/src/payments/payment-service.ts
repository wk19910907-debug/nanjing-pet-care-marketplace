import type { PrismaClient } from '@prisma/client';
import type { AuditRepository } from '../audit/audit-repository.js';
import type { PaymentGateway } from './payment-gateway.js';

export class PaymentService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly gateway: PaymentGateway,
    private readonly audit: AuditRepository,
  ) {}

  public async handleWebhook(payload: unknown, signature: string | undefined) {
    const event = this.gateway.verifyWebhook(payload, signature);
    const payment = await this.prisma.payment.findUnique({
      where: { orderId: event.orderId }, include: { order: true },
    });
    if (!payment || payment.provider !== this.gateway.providerName
      || payment.providerPaymentId !== event.providerPaymentId
      || payment.amountFen !== event.amountFen || payment.currency !== event.currency) {
      throw new Error('PAYMENT_VERIFICATION_FAILED');
    }
    if (payment.providerEventId === event.eventId && payment.status === 'SUCCEEDED') {
      return payment.order;
    }
    if (payment.status !== 'CREATED' || payment.order.status !== 'PENDING_PAYMENT') {
      throw new Error('PAYMENT_VERIFICATION_FAILED');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: {
        providerEventId: event.eventId, status: 'SUCCEEDED',
      }});
      const order = await tx.order.update({
        where: { id: event.orderId, version: payment.order.version },
        data: { status: 'PENDING_DISPATCH', version: { increment: 1 } },
      });
      await this.audit.append({
        actorId: null, actorRole: 'ADMIN', action: 'PAYMENT_VERIFIED',
        entityType: 'Order', entityId: order.id, metadata: { eventId: event.eventId },
      }, tx);
      return order;
    });
  }
}
