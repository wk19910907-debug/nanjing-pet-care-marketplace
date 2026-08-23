import type { ActorRole } from '@pet/contracts';
import { Prisma, type PrismaClient } from '@prisma/client';

export type AuditInput = {
  actorId: string | null;
  actorRole: ActorRole;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
};

export interface AuditRepository {
  append(input: AuditInput, transaction?: Prisma.TransactionClient): Promise<void>;
}

export class PrismaAuditRepository implements AuditRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async append(
    input: AuditInput,
    transaction?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = transaction ?? this.prisma;
    await client.auditEvent.create({
      data: {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata as Prisma.InputJsonValue,
      },
    });
  }
}
