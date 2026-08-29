import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaAuditRepository } from '../src/audit/audit-repository.js';
import { PrismaOperationsCatalogRepository } from '../src/catalog/operations-catalog-repository.js';
import { createDb } from '../src/db.js';

const prisma = createDb(process.env.DATABASE_URL);
const repository = new PrismaOperationsCatalogRepository(
  prisma,
  new PrismaAuditRepository(prisma),
);

describe('PrismaOperationsCatalogRepository', () => {
  beforeEach(async () => {
    await prisma.operationsCatalog.update({
      where: { id: '00000000-0000-4000-8000-000000000001' },
      data: {
        version: 1,
        catFeedingEnabled: true,
        catFeedingBasePriceFen: 3_200,
        dogWalkingEnabled: true,
        dogWalkingBasePriceFen: 3_700,
        openDistricts: ['JIANYE', 'GULOU', 'XUANWU', 'QINHUAI'],
        announcement: '',
        updatedByUserId: null,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('reads the seeded singleton as a strict administrator catalog', async () => {
    await expect(repository.get()).resolves.toMatchObject({
      version: 1,
      services: {
        CAT_FEEDING: { enabled: true, basePriceFen: 3_200 },
        DOG_WALKING: { enabled: true, basePriceFen: 3_700 },
      },
      openDistricts: ['JIANYE', 'GULOU', 'XUANWU', 'QINHUAI'],
      announcement: '',
    });
  });

  it('updates once at the expected version and appends an audit event', async () => {
    const actorId = randomUUID();
    await prisma.user.create({ data: { id: actorId, role: 'ADMIN', displayName: '运营测试员' } });

    const updated = await repository.compareAndSwap({
      expectedVersion: 1,
      services: {
        CAT_FEEDING: { enabled: true, basePriceFen: 3_500 },
        DOG_WALKING: { enabled: false, basePriceFen: 3_900 },
      },
      openDistricts: ['JIANYE'],
      announcement: '今日正常接单',
    }, actorId);

    expect(updated).toMatchObject({ version: 2, announcement: '今日正常接单' });
    await expect(prisma.auditEvent.findFirstOrThrow({
      where: {
        actorId,
        action: 'OPERATIONS_CATALOG_UPDATED',
        entityId: '00000000-0000-4000-8000-000000000001',
      },
    })).resolves.toMatchObject({
      metadata: expect.objectContaining({ fromVersion: 1, toVersion: 2 }),
    });
  });

  it('returns null without writing when the expected version is stale', async () => {
    const actorId = randomUUID();
    await prisma.user.create({ data: { id: actorId, role: 'ADMIN', displayName: '并发测试员' } });
    await expect(repository.compareAndSwap({
      expectedVersion: 99,
      services: {
        CAT_FEEDING: { enabled: true, basePriceFen: 3_500 },
        DOG_WALKING: { enabled: true, basePriceFen: 3_900 },
      },
      openDistricts: ['JIANYE'],
      announcement: '',
    }, actorId)).resolves.toBeNull();
    await expect(prisma.auditEvent.count({ where: { actorId } })).resolves.toBe(0);
  });
});
