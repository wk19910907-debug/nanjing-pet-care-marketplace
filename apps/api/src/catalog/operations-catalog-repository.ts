import {
  AdminOperationsCatalogSchema,
  type AdminOperationsCatalog,
  type OperationsCatalogUpdate,
} from '@pet/contracts';
import { Prisma, type OperationsCatalog, type PrismaClient } from '@prisma/client';
import type { AuditRepository } from '../audit/audit-repository.js';
import type { OperationsCatalogRepository } from './operations-catalog-service.js';

export const OPERATIONS_CATALOG_ID = '00000000-0000-4000-8000-000000000001';

function toContract(record: OperationsCatalog): AdminOperationsCatalog {
  return AdminOperationsCatalogSchema.parse({
    version: record.version,
    updatedAt: record.updatedAt.toISOString(),
    services: {
      CAT_FEEDING: {
        enabled: record.catFeedingEnabled,
        basePriceFen: record.catFeedingBasePriceFen,
      },
      DOG_WALKING: {
        enabled: record.dogWalkingEnabled,
        basePriceFen: record.dogWalkingBasePriceFen,
      },
    },
    openDistricts: record.openDistricts,
    announcement: record.announcement,
  });
}

export class PrismaOperationsCatalogRepository implements OperationsCatalogRepository {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditRepository,
  ) {}

  public async get(): Promise<AdminOperationsCatalog> {
    return toContract(await this.prisma.operationsCatalog.findUniqueOrThrow({
      where: { id: OPERATIONS_CATALOG_ID },
    }));
  }

  public async compareAndSwap(
    input: OperationsCatalogUpdate,
    updatedByUserId: string,
  ): Promise<AdminOperationsCatalog | null> {
    return this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.operationsCatalog.updateMany({
        where: { id: OPERATIONS_CATALOG_ID, version: input.expectedVersion },
        data: {
          version: { increment: 1 },
          catFeedingEnabled: input.services.CAT_FEEDING.enabled,
          catFeedingBasePriceFen: input.services.CAT_FEEDING.basePriceFen,
          dogWalkingEnabled: input.services.DOG_WALKING.enabled,
          dogWalkingBasePriceFen: input.services.DOG_WALKING.basePriceFen,
          openDistricts: input.openDistricts,
          announcement: input.announcement,
          updatedByUserId,
        },
      });
      if (changed.count !== 1) return null;

      const updated = await transaction.operationsCatalog.findUniqueOrThrow({
        where: { id: OPERATIONS_CATALOG_ID },
      });
      await this.audit.append({
        actorId: updatedByUserId,
        actorRole: 'ADMIN',
        action: 'OPERATIONS_CATALOG_UPDATED',
        entityType: 'OperationsCatalog',
        entityId: OPERATIONS_CATALOG_ID,
        metadata: {
          fromVersion: input.expectedVersion,
          toVersion: updated.version,
          services: input.services,
          openDistricts: input.openDistricts,
          announcement: input.announcement,
        },
      }, transaction as Prisma.TransactionClient);
      return toContract(updated);
    });
  }
}
