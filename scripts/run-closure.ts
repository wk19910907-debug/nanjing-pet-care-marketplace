import { randomUUID } from 'node:crypto';
import type { PrismaClient, ServiceType } from '@prisma/client';
import { FakeObjectStorage } from '../apps/api/src/adapters/fake-object-storage.js';
import { FakePaymentGateway } from '../apps/api/src/adapters/fake-payment-gateway.js';
import { PrismaAuditRepository } from '../apps/api/src/audit/audit-repository.js';
import type { ActorContext } from '../apps/api/src/auth/auth-service.js';
import { DisputeService } from '../apps/api/src/disputes/dispute-service.js';
import { DispatchService } from '../apps/api/src/dispatch/dispatch-service.js';
import { FulfillmentService } from '../apps/api/src/fulfillment/fulfillment-service.js';
import { PaymentService } from '../apps/api/src/payments/payment-service.js';
import { SettlementService } from '../apps/api/src/payments/settlement-service.js';

export async function runClosure(prisma: PrismaClient) {
  const audit = new PrismaAuditRepository(prisma);
  const gateway = new FakePaymentGateway('closure-secret');
  const payments = new PaymentService(prisma, gateway, audit);
  const dispatch = new DispatchService(prisma, audit, { notify: async () => undefined });
  const storage = new FakeObjectStorage();
  const fulfillment = new FulfillmentService(prisma, audit, storage, {
    maxUploadBytes: 20 * 1024 * 1024, readUrlTtlSeconds: 300,
  });
  const settlements = new SettlementService(prisma, audit, { commissionBps: 2000, autoConfirmHours: 24 });
  const disputes = new DisputeService(prisma, gateway, audit);

  const ownerUser = await prisma.user.create({ data: { role: 'OWNER', phoneHash: randomUUID() } });
  const closureZone = `闭环-${randomUUID()}`;
  const owner = { userId: ownerUser.id, role: 'OWNER' } as ActorContext;
  const supportUser = await prisma.user.create({ data: { role: 'SUPPORT', phoneHash: randomUUID() } });
  const support = { userId: supportUser.id, role: 'SUPPORT' } as ActorContext;
  const [cat, dog] = await Promise.all([
    prisma.pet.create({ data: { ownerId: ownerUser.id, name: '团子', species: 'CAT_FEEDING' } }),
    prisma.pet.create({ data: { ownerId: ownerUser.id, name: '豆包', species: 'DOG_WALKING' } }),
  ]);
  const address = await prisma.serviceAddress.create({ data: {
    ownerId: ownerUser.id, city: '南京市', district: '建邺区', serviceZone: closureZone,
    latitude: 32.0123, longitude: 118.7356, detailCiphertext: new Uint8Array([1]),
    detailNonce: new Uint8Array([1]), detailAuthTag: new Uint8Array([1]), encryptionKeyVersion: 1,
  }});
  const closureStart = new Date(Date.now() + 60 * 60_000);
  const providerFixtures = [];
  for (let index = 0; index < 4; index += 1) {
    const user = await prisma.user.create({ data: { role: 'PROVIDER', phoneHash: randomUUID() } });
    const profile = await prisma.providerProfile.create({ data: {
      userId: user.id, reviewStatus: 'APPROVED', serviceTypes: ['CAT_FEEDING', 'DOG_WALKING'],
      catExperienceMonths: 12 + index, dogExperienceMonths: 12 + index, serviceZone: closureZone,
      latitude: 32.0123 + index * 0.0001, longitude: 118.7356, radiusKm: 5,
      availability: { create: { startsAt: new Date(closureStart.getTime() - 60 * 60_000),
        endsAt: new Date(closureStart.getTime() + 6 * 60 * 60_000) } },
    }});
    providerFixtures.push({ user, profile });
  }

  async function createPaidOrder(serviceType: ServiceType, petId: string, totalFen: number, startsAt: Date) {
    const orderId = randomUUID();
    const order = await prisma.order.create({ data: {
      id: orderId, ownerId: ownerUser.id, addressId: address.id, idempotencyKey: randomUUID(),
      serviceType, startsAt, durationMinutes: 30, quoteSnapshot: { totalFen }, totalFen,
      pets: { create: { petId } }, payment: { create: {
        provider: 'fake', providerPaymentId: `fake-pay-${orderId}`, amountFen: totalFen,
      }},
    }});
    const event = gateway.successEvent(order.id, totalFen);
    await payments.handleWebhook(event, gateway.sign(event));
    return order;
  }

  async function fulfill(orderId: string, providerUserId: string, startsAt: Date, serviceType: ServiceType) {
    const actor = { userId: providerUserId, role: 'PROVIDER' } as ActorContext;
    await fulfillment.checkIn(actor, orderId, startsAt, { petSafe: true });
    const sha256 = serviceType === 'CAT_FEEDING' ? 'a'.repeat(64) : 'b'.repeat(64);
    const upload = await fulfillment.issueUpload(actor, orderId, { mimeType: 'image/jpeg', sizeBytes: 1024, sha256 });
    storage.completeUpload(upload.objectKey);
    await fulfillment.attachEvidence(actor, orderId, {
      objectKey: upload.objectKey, mimeType: 'image/jpeg', sizeBytes: 1024, sha256, capturedAt: startsAt,
    });
    const checklist = serviceType === 'CAT_FEEDING'
      ? { petCountConfirmed: true, foodRefilled: true, waterRefilled: true, litterCleaned: true }
      : { leashSecured: true, walkDurationMinutes: 30 };
    await fulfillment.submitReport(actor, orderId, {
      checklist, afterState: { petSafe: true }, notes: '闭环测试正常',
      checkedOutAt: new Date(startsAt.getTime() + 30 * 60_000),
    });
  }

  const catOrder = await createPaidOrder('CAT_FEEDING', cat.id, 3900, closureStart);
  const catWaveOne = await dispatch.start(catOrder.id, new Date());
  const catWaveTwo = await dispatch.expireWave(catOrder.id,
    new Date(Math.max(...catWaveOne.map((item) => item.expiresAt.getTime())) + 1));
  const catInvite = catWaveTwo[0]!;
  await dispatch.acceptInvitation(catInvite.id, catInvite.providerId, new Date());
  const catProvider = providerFixtures.find((item) => item.profile.id === catInvite.providerId)!;
  await fulfill(catOrder.id, catProvider.user.id, catOrder.startsAt, 'CAT_FEEDING');
  await settlements.confirmOrder(owner, catOrder.id, new Date());

  const dogStart = new Date(closureStart.getTime() + 2 * 60 * 60_000);
  const dogOrder = await createPaidOrder('DOG_WALKING', dog.id, 4200, dogStart);
  const dogInvitations = await dispatch.start(dogOrder.id, new Date());
  const dogInvite = dogInvitations[0]!;
  await dispatch.acceptInvitation(dogInvite.id, dogInvite.providerId, new Date());
  const dogProvider = providerFixtures.find((item) => item.profile.id === dogInvite.providerId)!;
  await fulfill(dogOrder.id, dogProvider.user.id, dogOrder.startsAt, 'DOG_WALKING');
  const dogDispute = await disputes.openDispute(owner, dogOrder.id, '闭环测试全额退款');
  await disputes.resolveDispute(support, dogDispute.id, { refundFen: 4200, resolution: '全额退款' });

  async function summarize(orderId: string) {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId }, include: { settlement: true, refunds: true },
    });
    const events = await prisma.auditEvent.findMany({ where: { entityType: 'Order', entityId: orderId }, orderBy: { createdAt: 'asc' } });
    return {
      id: order.id, serviceType: order.serviceType, status: order.status,
      settlement: order.settlement?.availableAt ? 'AVAILABLE' as const : 'NONE' as const,
      refundFen: order.refunds.reduce((sum, refund) => sum + refund.amountFen, 0),
      auditActions: events.map((event) => event.action),
    };
  }
  return {
    fixture: { owners: 1, cats: 1, dogs: 1, addresses: 1, providers: 4 },
    orders: [await summarize(catOrder.id), await summarize(dogOrder.id)],
  };
}
