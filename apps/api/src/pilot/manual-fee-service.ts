import { Prisma, type Payment, type PrismaClient } from '@prisma/client';
import type { AuditRepository } from '../audit/audit-repository.js';
import type { ActorContext } from '../auth/auth-service.js';
import { authorizeRole } from '../auth/authorize.js';

const MANUAL_PROVIDER = 'pilot-manual';

export type ManualFeeConfirmation = {
  id: string;
  orderId: string;
  provider: 'pilot-manual';
  status: 'SUCCEEDED';
  amountFen: number;
  currency: 'CNY';
};

function toConfirmation(payment: Payment): ManualFeeConfirmation {
  return {
    id: payment.id,
    orderId: payment.orderId,
    provider: MANUAL_PROVIDER,
    status: 'SUCCEEDED',
    amountFen: payment.amountFen,
    currency: 'CNY',
  };
}

function isValidIdempotencyKey(value: string): boolean {
  return value.length >= 8 && value.length <= 100;
}

export class ManualFeeService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditRepository,
  ) {}

  public async confirm(
    actor: ActorContext,
    orderId: string,
    idempotencyKey: string,
  ): Promise<ManualFeeConfirmation> {
    authorizeRole(actor, ['ADMIN']);
    if (!isValidIdempotencyKey(idempotencyKey)) throw new Error('VALIDATION_ERROR');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const keyedPayment = await tx.payment.findUnique({
          where: { manualConfirmationKey: idempotencyKey },
        });
        if (keyedPayment) {
          if (
            keyedPayment.orderId === orderId
            && keyedPayment.provider === MANUAL_PROVIDER
            && keyedPayment.status === 'SUCCEEDED'
          ) {
            return toConfirmation(keyedPayment);
          }
          throw new Error('MANUAL_FEE_CONFLICT');
        }

        const payment = await tx.payment.findUnique({
          where: { orderId },
          include: { order: true },
        });
        if (!payment || payment.provider !== MANUAL_PROVIDER) {
          throw new Error('MANUAL_FEE_CONFLICT');
        }
        if (
          payment.manualConfirmationKey !== null
          || payment.status !== 'CREATED'
          || payment.order.status !== 'PENDING_PAYMENT'
        ) {
          throw new Error('MANUAL_FEE_CONFLICT');
        }

        const confirmed = await tx.payment.updateMany({
          where: {
            id: payment.id,
            provider: MANUAL_PROVIDER,
            status: 'CREATED',
            manualConfirmationKey: null,
          },
          data: {
            status: 'SUCCEEDED',
            manualConfirmationKey: idempotencyKey,
            providerEventId: `${MANUAL_PROVIDER}:${idempotencyKey}`,
          },
        });
        if (confirmed.count !== 1) {
          const replay = await tx.payment.findUnique({
            where: { manualConfirmationKey: idempotencyKey },
          });
          if (
            replay?.orderId === orderId
            && replay.provider === MANUAL_PROVIDER
            && replay.status === 'SUCCEEDED'
          ) {
            return toConfirmation(replay);
          }
          throw new Error('MANUAL_FEE_CONFLICT');
        }

        const advanced = await tx.order.updateMany({
          where: {
            id: orderId,
            status: 'PENDING_PAYMENT',
            version: payment.order.version,
          },
          data: { status: 'PENDING_DISPATCH', version: { increment: 1 } },
        });
        if (advanced.count !== 1) throw new Error('MANUAL_FEE_CONFLICT');

        await this.audit.append({
          actorId: actor.userId,
          actorRole: actor.role,
          action: 'MANUAL_FEE_CONFIRMED',
          entityType: 'Order',
          entityId: orderId,
          metadata: { provider: MANUAL_PROVIDER, amountFen: payment.amountFen },
        }, tx);

        return toConfirmation(await tx.payment.findUniqueOrThrow({ where: { id: payment.id } }));
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.prisma.payment.findUnique({
          where: { manualConfirmationKey: idempotencyKey },
        });
        if (
          replay?.orderId === orderId
          && replay.provider === MANUAL_PROVIDER
          && replay.status === 'SUCCEEDED'
        ) {
          return toConfirmation(replay);
        }
        throw new Error('MANUAL_FEE_CONFLICT');
      }
      throw error;
    }
  }
}
