import type { PrismaClient } from '@prisma/client';

export interface JobSource { expiredDispatchOrderIds(now: Date): Promise<string[]> }
export class PrismaJobSource implements JobSource {
  public constructor(private readonly prisma: PrismaClient) {}
  public async expiredDispatchOrderIds(now: Date) {
    const invitations = await this.prisma.dispatchInvitation.findMany({
      where: { status: 'PENDING', expiresAt: { lte: now }, order: { status: 'PENDING_DISPATCH' } },
      distinct: ['orderId'], select: { orderId: true },
    });
    return invitations.map((item) => item.orderId);
  }
}

export class ScheduledJobs {
  public constructor(
    private readonly source: JobSource,
    private readonly dispatch: { expireWave(orderId: string, now: Date): Promise<unknown> },
    private readonly settlements: { autoConfirmDueOrders(now: Date): Promise<unknown> },
  ) {}
  public async runDue(now: Date) {
    const orderIds = [...new Set(await this.source.expiredDispatchOrderIds(now))];
    for (const orderId of orderIds) await this.dispatch.expireWave(orderId, now);
    await this.settlements.autoConfirmDueOrders(now);
    return { expiredInvitationOrders: orderIds.length };
  }
}
