import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaAuditRepository } from '../src/audit/audit-repository.js';
import { createDb } from '../src/db.js';

const prisma = createDb(process.env.DATABASE_URL);
const repository = new PrismaAuditRepository(prisma);

describe('PrismaAuditRepository', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('appends an audit event without exposing mutation methods', async () => {
    const entityId = randomUUID();
    await repository.append({
      actorId: null,
      actorRole: 'ADMIN',
      action: 'TEST_EVENT',
      entityType: 'Order',
      entityId,
      metadata: { source: 'integration-test' },
    });

    const saved = await prisma.auditEvent.findFirstOrThrow({ where: { entityId } });
    expect(saved).toMatchObject({ action: 'TEST_EVENT', entityId, actorRole: 'ADMIN' });
    expect('update' in repository).toBe(false);
    expect('delete' in repository).toBe(false);
  });

  it('rejects database updates and deletes', async () => {
    const saved = await prisma.auditEvent.findFirstOrThrow();
    await expect(prisma.auditEvent.update({
      where: { id: saved.id }, data: { action: 'MUTATED' },
    })).rejects.toThrow(/audit events are immutable/i);
    await expect(prisma.auditEvent.delete({ where: { id: saved.id } })).rejects.toThrow(
      /audit events are immutable/i,
    );
  });
});
