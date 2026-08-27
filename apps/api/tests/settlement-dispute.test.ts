import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { FakePaymentGateway } from '../src/adapters/fake-payment-gateway.js';
import { FieldCrypto } from '../src/adapters/field-crypto.js';
import { createApp } from '../src/app.js';
import { PrismaAuditRepository } from '../src/audit/audit-repository.js';
import type { ActorContext, AuthService } from '../src/auth/auth-service.js';
import { createDb } from '../src/db.js';
import { DisputeService } from '../src/disputes/dispute-service.js';
import { RefundService } from '../src/payments/refund-service.js';
import { SettlementService } from '../src/payments/settlement-service.js';
import { AddressService } from '../src/pets/address-service.js';
import { PetService } from '../src/pets/pet-service.js';

const prisma = createDb(process.env.DATABASE_URL);
const audit = new PrismaAuditRepository(prisma);
const gateway = new FakePaymentGateway('settlement-test');
const settlements = new SettlementService(prisma, audit, { commissionBps: 2000, autoConfirmHours: 24 });
const refunds = new RefundService(prisma, gateway, audit, { lateCancellationFeeBps: 2000 });
const disputes = new DisputeService(prisma, gateway, audit);

class DatabaseHeaderAuth implements AuthService {
  public async authenticate(value: string | undefined): Promise<ActorContext> {
    if (!value?.startsWith('Bearer ')) throw new Error('UNAUTHENTICATED');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: value.slice(7) } });
    return { userId: user.id, role: user.role };
  }
}
const crypto = FieldCrypto.fromBase64(Buffer.alloc(32, 9).toString('base64'), 1);
const app = createApp({
  auth: new DatabaseHeaderAuth(), pets: new PetService(prisma, crypto),
  addresses: new AddressService(prisma, crypto, audit), settlements, refunds, disputes,
});

async function fixture(status: 'PENDING_CONFIRMATION' | 'PENDING_DISPATCH' | 'PENDING_SERVICE') {
  const ownerUser = await prisma.user.create({ data: { role: 'OWNER', phoneHash: randomUUID() } });
  const providerUser = await prisma.user.create({ data: { role: 'PROVIDER', phoneHash: randomUUID() } });
  const provider = await prisma.providerProfile.create({ data: {
    userId: providerUser.id, reviewStatus: 'APPROVED', serviceTypes: ['CAT_FEEDING'],
    serviceZone: '奥体东', latitude: 32.01, longitude: 118.73, radiusKm: 5,
  }});
  const address = await prisma.serviceAddress.create({ data: {
    ownerId: ownerUser.id, city: '南京市', district: '建邺区', serviceZone: '奥体东',
    latitude: 32.01, longitude: 118.73, detailCiphertext: new Uint8Array([1]),
    detailNonce: new Uint8Array([1]), detailAuthTag: new Uint8Array([1]), encryptionKeyVersion: 1,
  }});
  const assigned = status === 'PENDING_SERVICE' || status === 'PENDING_CONFIRMATION';
  const order = await prisma.order.create({ data: {
    ownerId: ownerUser.id, addressId: address.id, assignedProviderId: assigned ? provider.id : null,
    idempotencyKey: randomUUID(), serviceType: 'CAT_FEEDING', status,
    startsAt: new Date(), durationMinutes: 30, quoteSnapshot: { totalFen: 3901 }, totalFen: 3901,
    payment: { create: { provider: 'fake', providerPaymentId: `fake-pay-${randomUUID()}`, status: 'SUCCEEDED', amountFen: 3901 } },
  }});
  return {
    order, provider,
    owner: { userId: ownerUser.id, role: 'OWNER' } as ActorContext,
    support: await prisma.user.create({ data: { role: 'SUPPORT', phoneHash: randomUUID() } }),
  };
}

describe('confirmation, cancellation, disputes and settlement', () => {
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it('exposes owner confirmation over authenticated HTTP', async () => {
    const item = await fixture('PENDING_CONFIRMATION');
    const response = await app.inject({
      method: 'POST', url: `/v1/orders/${item.order.id}/confirm`,
      headers: { authorization: `Bearer ${item.owner.userId}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      orderId: item.order.id, status: 'COMPLETED', confirmedAt: expect.any(String),
    });
    expect(response.body).not.toMatch(/providerId|providerFen|commissionFen|commissionBps|availableAt/);
  });

  it('creates withdrawable integer settlement only after owner confirmation', async () => {
    const item = await fixture('PENDING_CONFIRMATION');
    expect(await prisma.settlement.findUnique({ where: { orderId: item.order.id } })).toBeNull();
    await settlements.confirmOrder(item.owner, item.order.id, new Date());
    expect(await prisma.settlement.findUniqueOrThrow({ where: { orderId: item.order.id } })).toMatchObject({
      grossFen: 3901, commissionFen: 780, providerFen: 3121, commissionBps: 2000,
    });
    expect((await prisma.settlement.findUniqueOrThrow({ where: { orderId: item.order.id } })).availableAt).toBeTruthy();
  });

  it('auto-confirms reports after 24 hours and is idempotent across workers', async () => {
    const item = await fixture('PENDING_CONFIRMATION');
    await prisma.fulfillmentReport.create({ data: {
      orderId: item.order.id, providerId: item.provider.id, checkedInAt: new Date(Date.now() - 26 * 3_600_000),
      submittedAt: new Date(Date.now() - 25 * 3_600_000),
    }});
    const now = new Date();
    await Promise.all([settlements.autoConfirmDueOrders(now), settlements.autoConfirmDueOrders(now)]);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: item.order.id } })).toMatchObject({ status: 'COMPLETED' });
    expect(await prisma.settlement.count({ where: { orderId: item.order.id } })).toBe(1);
  });

  it('cancels before assignment with a full refund and applies configured late fee after assignment', async () => {
    const early = await fixture('PENDING_DISPATCH');
    const earlyRefund = await refunds.requestCancellation(early.owner, early.order.id, '行程取消');
    expect(earlyRefund.amountFen).toBe(3901);
    const late = await fixture('PENDING_SERVICE');
    const lateRefund = await refunds.requestCancellation(late.owner, late.order.id, '临时取消');
    expect(lateRefund.amountFen).toBe(3121);
  });

  it('freezes settlement during dispute and resolves partial refund idempotently', async () => {
    const item = await fixture('PENDING_CONFIRMATION');
    await settlements.confirmOrder(item.owner, item.order.id, new Date());
    const dispute = await disputes.openDispute(item.owner, item.order.id, '照片与服务不符');
    expect((await prisma.settlement.findUniqueOrThrow({ where: { orderId: item.order.id } })).availableAt).toBeNull();
    const operator = { userId: item.support.id, role: 'SUPPORT' } as ActorContext;
    const first = await disputes.resolveDispute(operator, dispute.id, { refundFen: 1000, resolution: '部分退款' });
    const replay = await disputes.resolveDispute(operator, dispute.id, { refundFen: 1000, resolution: '部分退款' });
    expect(first.status).toBe('RESOLVED_PARTIAL_REFUND');
    expect(replay.id).toBe(first.id);
    expect(await prisma.refund.count({ where: { orderId: item.order.id } })).toBe(1);
  });
});
