import type { PrismaClient } from '@prisma/client';
import type { AuditRepository } from '../audit/audit-repository.js';
import type { ActorContext } from '../auth/auth-service.js';
import { authorizeOwner } from '../auth/authorize.js';
import type { PaymentGateway } from './payment-gateway.js';

export class RefundService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly gateway: PaymentGateway,
    private readonly audit: AuditRepository,
    private readonly config: { lateCancellationFeeBps: number },
  ) {}

  public async requestCancellation(actor: ActorContext, orderId: string, reason: string) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payment: true } });
    authorizeOwner(actor, order.ownerId);
    if (!order.payment || order.payment.status !== 'SUCCEEDED') throw new Error('CANCELLATION_NOT_ALLOWED');
    if (!['PENDING_DISPATCH', 'PENDING_SERVICE'].includes(order.status)) throw new Error('CANCELLATION_NOT_ALLOWED');
    const existing = await this.prisma.refund.findFirst({ where: { orderId, reason: { startsWith: 'CANCELLATION:' } } });
    if (existing) return existing;
    const feeFen = order.assignedProviderId
      ? Math.floor(order.totalFen * this.config.lateCancellationFeeBps / 10_000) : 0;
    const amountFen = order.totalFen - feeFen;
    const provider = await this.gateway.refund({ orderId, amountFen, reason });
    return this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.create({ data: {
        orderId, paymentId: order.payment!.id, providerRefundId: provider.providerRefundId,
        amountFen, reason: `CANCELLATION:${reason}`, status: 'REFUNDED',
      }});
      await tx.payment.update({ where: { id: order.payment!.id }, data: {
        status: amountFen === order.totalFen ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      }});
      await tx.order.update({ where: { id: orderId }, data: { status: 'CANCELLED', version: { increment: 1 } } });
      await this.audit.append({
        actorId: actor.userId, actorRole: actor.role, action: 'ORDER_CANCELLED',
        entityType: 'Order', entityId: orderId, metadata: { refundFen: amountFen, feeFen },
      }, tx);
      return refund;
    });
  }
}
