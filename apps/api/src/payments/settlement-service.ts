import { Prisma, type PrismaClient } from '@prisma/client';
import { calculateSettlement } from '@pet/domain';
import type { AuditRepository } from '../audit/audit-repository.js';
import type { ActorContext } from '../auth/auth-service.js';
import { authorizeOwner } from '../auth/authorize.js';

export class SettlementService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditRepository,
    private readonly config: { commissionBps: number; autoConfirmHours: number },
  ) {}

  public async confirmOrder(actor: ActorContext, orderId: string, now: Date) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    authorizeOwner(actor, order.ownerId);
    return this.confirm(orderId, now, actor);
  }

  public async autoConfirmDueOrders(now: Date) {
    const cutoff = new Date(now.getTime() - this.config.autoConfirmHours * 3_600_000);
    const due = await this.prisma.order.findMany({
      where: { status: 'PENDING_CONFIRMATION', report: { submittedAt: { lte: cutoff } } },
      select: { id: true },
    });
    const results = [];
    for (const order of due) {
      const confirmed = await this.confirm(order.id, now, null);
      if (confirmed) results.push(confirmed);
    }
    return results;
  }

  private async confirm(orderId: string, now: Date, actor: ActorContext | null) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (order.status === 'COMPLETED') return tx.settlement.findUnique({ where: { orderId } });
      if (order.status !== 'PENDING_CONFIRMATION' || !order.assignedProviderId) {
        if (actor) throw new Error('CONFIRMATION_NOT_ALLOWED');
        return null;
      }
      const openDispute = await tx.dispute.count({ where: { orderId, status: 'OPEN' } });
      if (openDispute > 0) return null;
      const changed = await tx.order.updateMany({
        where: { id: orderId, status: 'PENDING_CONFIRMATION', version: order.version },
        data: { status: 'COMPLETED', version: { increment: 1 } },
      });
      if (changed.count !== 1) return null;
      const money = calculateSettlement(order.totalFen, this.config.commissionBps);
      const settlement = await tx.settlement.create({
        data: { orderId, providerId: order.assignedProviderId, ...money, availableAt: now },
      });
      await this.audit.append({
        actorId: actor?.userId ?? null, actorRole: actor?.role ?? 'ADMIN',
        action: actor ? 'ORDER_CONFIRMED' : 'ORDER_AUTO_CONFIRMED', entityType: 'Order', entityId: orderId,
        metadata: { settlementId: settlement.id },
      }, tx);
      return settlement;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return null;
      throw error;
    });
  }
}
