import type { DisputeStatus, PrismaClient } from '@prisma/client';
import { calculateSettlement } from '@pet/domain';
import type { AuditRepository } from '../audit/audit-repository.js';
import type { ActorContext } from '../auth/auth-service.js';
import { authorizeOwner, authorizeRole } from '../auth/authorize.js';
import type { PaymentGateway } from '../payments/payment-gateway.js';

export class DisputeService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly gateway: PaymentGateway,
    private readonly audit: AuditRepository,
  ) {}

  public async openDispute(actor: ActorContext, orderId: string, reason: string) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    authorizeOwner(actor, order.ownerId);
    if (!['PENDING_CONFIRMATION', 'COMPLETED'].includes(order.status)) throw new Error('DISPUTE_NOT_ALLOWED');
    const existing = await this.prisma.dispute.findFirst({ where: { orderId, status: 'OPEN' } });
    if (existing) return existing;
    return this.prisma.$transaction(async (tx) => {
      const dispute = await tx.dispute.create({ data: { orderId, openedById: actor.userId, reason } });
      await tx.order.update({ where: { id: orderId }, data: { status: 'DISPUTED', version: { increment: 1 } } });
      await tx.settlement.updateMany({ where: { orderId }, data: { availableAt: null } });
      await this.audit.append({
        actorId: actor.userId, actorRole: actor.role, action: 'DISPUTE_OPENED',
        entityType: 'Order', entityId: orderId, metadata: { disputeId: dispute.id },
      }, tx);
      return dispute;
    });
  }

  public async resolveDispute(
    actor: ActorContext,
    disputeId: string,
    input: { refundFen: number; resolution: string },
  ) {
    authorizeRole(actor, ['SUPPORT', 'ADMIN']);
    const dispute = await this.prisma.dispute.findUniqueOrThrow({
      where: { id: disputeId }, include: { order: { include: { payment: true, settlement: true } } },
    });
    if (dispute.status !== 'OPEN') return dispute;
    if (!Number.isInteger(input.refundFen) || input.refundFen < 0 || input.refundFen > dispute.order.totalFen) {
      throw new Error('VALIDATION_ERROR');
    }
    const status: DisputeStatus = input.refundFen === 0 ? 'RESOLVED_NO_REFUND'
      : input.refundFen === dispute.order.totalFen ? 'RESOLVED_FULL_REFUND' : 'RESOLVED_PARTIAL_REFUND';
    const providerRefund = input.refundFen > 0
      ? await this.gateway.refund({ orderId: dispute.orderId, amountFen: input.refundFen, reason: input.resolution })
      : null;
    return this.prisma.$transaction(async (tx) => {
      if (providerRefund && dispute.order.payment) {
        await tx.refund.create({ data: {
          orderId: dispute.orderId, paymentId: dispute.order.payment.id,
          providerRefundId: providerRefund.providerRefundId, amountFen: input.refundFen,
          reason: `DISPUTE:${input.resolution}`,
          status: status === 'RESOLVED_FULL_REFUND' ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
        }});
        await tx.payment.update({ where: { id: dispute.order.payment.id }, data: {
          status: status === 'RESOLVED_FULL_REFUND' ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
        }});
      }
      if (dispute.order.settlement && status !== 'RESOLVED_FULL_REFUND') {
        const money = calculateSettlement(dispute.order.totalFen - input.refundFen, dispute.order.settlement.commissionBps);
        await tx.settlement.update({ where: { orderId: dispute.orderId }, data: { ...money, availableAt: new Date() } });
      }
      const resolved = await tx.dispute.update({ where: { id: disputeId }, data: {
        status, refundFen: input.refundFen, resolution: input.resolution,
        resolvedById: actor.userId, resolvedAt: new Date(),
      }});
      await tx.order.update({ where: { id: dispute.orderId }, data: {
        status: status === 'RESOLVED_FULL_REFUND' ? 'REFUNDED' : 'COMPLETED', version: { increment: 1 },
      }});
      await this.audit.append({
        actorId: actor.userId, actorRole: actor.role, action: 'DISPUTE_RESOLVED',
        entityType: 'Order', entityId: dispute.orderId, metadata: { disputeId, status, refundFen: input.refundFen },
      }, tx);
      return resolved;
    });
  }
}
