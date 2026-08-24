import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db.js';
import { runClosure } from '../../../scripts/run-closure.js';

const prisma = createDb(process.env.DATABASE_URL);

describe('deterministic two-service pilot closure', () => {
  afterAll(async () => prisma.$disconnect());

  it('closes cat feeding to settlement and dog walking through a full-refund dispute', async () => {
    const result = await runClosure(prisma);
    expect(result.fixture).toMatchObject({ owners: 1, cats: 1, dogs: 1, addresses: 1, providers: 4 });
    expect(result.orders).toEqual([
      expect.objectContaining({ serviceType: 'CAT_FEEDING', status: 'COMPLETED', settlement: 'AVAILABLE', refundFen: 0 }),
      expect.objectContaining({ serviceType: 'DOG_WALKING', status: 'REFUNDED', settlement: 'NONE', refundFen: 4200 }),
    ]);
    expect(result.orders[0]!.auditActions).toEqual([
      'PAYMENT_VERIFIED', 'DISPATCH_WAVE_STARTED', 'DISPATCH_WAVE_STARTED',
      'DISPATCH_INVITATION_ACCEPTED', 'SERVICE_CHECKED_IN', 'SERVICE_EVIDENCE_ATTACHED',
      'SERVICE_REPORT_SUBMITTED', 'ORDER_CONFIRMED',
    ]);
    expect(result.orders[1]!.auditActions).toEqual([
      'PAYMENT_VERIFIED', 'DISPATCH_WAVE_STARTED', 'DISPATCH_INVITATION_ACCEPTED',
      'SERVICE_CHECKED_IN', 'SERVICE_EVIDENCE_ATTACHED', 'SERVICE_REPORT_SUBMITTED',
      'DISPUTE_OPENED', 'DISPUTE_RESOLVED',
    ]);
  }, 30_000);
});
