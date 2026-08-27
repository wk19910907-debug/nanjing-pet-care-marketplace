import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaAuditRepository } from '../src/audit/audit-repository.js';
import { createDb } from '../src/db.js';
import { DispatchService } from '../src/dispatch/dispatch-service.js';
import { ProviderService } from '../src/dispatch/provider-service.js';

const prisma = createDb(process.env.DATABASE_URL);
const alerts: Array<{ orderId: string; reason: string }> = [];
const audit = new PrismaAuditRepository(prisma);
const providers = new ProviderService(prisma, audit);
const dispatch = new DispatchService(prisma, audit, {
  notify: async (alert) => { alerts.push(alert); },
});

async function createOrder() {
  const owner = await prisma.user.create({ data: { role: 'OWNER', phoneHash: randomUUID() } });
  const address = await prisma.serviceAddress.create({ data: {
    ownerId: owner.id, city: '南京市', district: '建邺区', serviceZone: '奥体东',
    latitude: 32.0123, longitude: 118.7356,
    detailCiphertext: new Uint8Array([1]), detailNonce: new Uint8Array([1]),
    detailAuthTag: new Uint8Array([1]), encryptionKeyVersion: 1,
  }});
  return prisma.order.create({ data: {
    ownerId: owner.id, addressId: address.id, idempotencyKey: randomUUID(),
    serviceType: 'CAT_FEEDING', status: 'PENDING_DISPATCH',
    startsAt: new Date(Date.now() + 24 * 60 * 60_000), durationMinutes: 30,
    quoteSnapshot: { totalFen: 3900 }, totalFen: 3900,
  }});
}

async function createProvider(index: number, startsAt: Date) {
  const user = await prisma.user.create({ data: { role: 'PROVIDER', phoneHash: randomUUID() } });
  const profile = await providers.apply({ userId: user.id, role: 'PROVIDER' }, {
    serviceTypes: ['CAT_FEEDING'], serviceZone: '奥体东',
    latitude: 32.0123 + index * 0.001, longitude: 118.7356,
    radiusKm: 5, catExperienceMonths: 12 + index, dogExperienceMonths: 0,
  });
  const reviewer = await prisma.user.create({ data: { role: 'REVIEWER', phoneHash: randomUUID() } });
  await providers.review({ userId: reviewer.id, role: 'REVIEWER' }, profile.id, 'APPROVED');
  await providers.setAvailability({ userId: user.id, role: 'PROVIDER' }, {
    startsAt: new Date(startsAt.getTime() - 60 * 60_000),
    endsAt: new Date(startsAt.getTime() + 120 * 60_000),
  });
  return { user, profile };
}

describe('managed dispatch', () => {
  afterAll(async () => prisma.$disconnect());

  it('creates one idempotent three-provider invitation wave', async () => {
    const order = await createOrder();
    await Promise.all(Array.from({ length: 4 }, (_, index) => createProvider(index, order.startsAt)));
    const first = await dispatch.start(order.id, new Date());
    const replay = await dispatch.start(order.id, new Date());
    expect(first).toHaveLength(3);
    expect(replay.map((item) => item.id)).toEqual(first.map((item) => item.id));
    expect(first.every((item) => item.wave === 1)).toBe(true);
    expect(first[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
  });

  it('allows only one concurrent invitation acceptance', async () => {
    const order = await createOrder();
    await Promise.all(Array.from({ length: 3 }, (_, index) => createProvider(index + 10, order.startsAt)));
    const invitations = await dispatch.start(order.id, new Date());
    const results = await Promise.allSettled([
      dispatch.acceptInvitation(invitations[0]!.id, invitations[0]!.providerId, new Date()),
      dispatch.acceptInvitation(invitations[1]!.id, invitations[1]!.providerId, new Date()),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(saved).toMatchObject({ status: 'PENDING_SERVICE', version: 1 });
    expect(saved.assignedProviderId).toBeTruthy();
  });

  it('hides a still-pending invitation from a different provider', async () => {
    const order = await createOrder();
    await createProvider(40, order.startsAt);
    const invitations = await dispatch.start(order.id, new Date());
    const pending = invitations[0]!;
    const outsider = await createProvider(41, order.startsAt);

    await expect(dispatch.acceptInvitation(pending.id, outsider.profile.id, new Date()))
      .rejects.toThrow('FORBIDDEN');
    expect(await prisma.dispatchInvitation.findUniqueOrThrow({ where: { id: pending.id } }))
      .toMatchObject({ status: 'PENDING', providerId: pending.providerId });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } }))
      .toMatchObject({ status: 'PENDING_DISPATCH', assignedProviderId: null });
  });

  it('cancels pending invitations when a provider is suspended', async () => {
    const order = await createOrder();
    const provider = await createProvider(50, order.startsAt);
    const invitation = await prisma.dispatchInvitation.create({ data: {
      orderId: order.id, providerId: provider.profile.id, wave: 1,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    }});
    const reviewer = await prisma.user.create({ data: { role: 'REVIEWER', phoneHash: randomUUID() } });

    await providers.review(
      { userId: reviewer.id, role: 'REVIEWER' }, provider.profile.id, 'SUSPENDED',
    );

    expect(await prisma.dispatchInvitation.findUniqueOrThrow({ where: { id: invitation.id } }))
      .toMatchObject({ status: 'CANCELLED' });
    await expect(dispatch.acceptInvitation(invitation.id, provider.profile.id, new Date()))
      .rejects.toThrow('DISPATCH_CONFLICT');
  });

  it('rechecks provider eligibility when accepting an existing invitation', async () => {
    const order = await createOrder();
    const provider = await createProvider(51, order.startsAt);
    const invitation = await prisma.dispatchInvitation.create({ data: {
      orderId: order.id, providerId: provider.profile.id, wave: 1,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    }});
    await prisma.providerProfile.update({
      where: { id: provider.profile.id }, data: { acceptsInvitations: false },
    });

    await expect(dispatch.acceptInvitation(invitation.id, provider.profile.id, new Date()))
      .rejects.toThrow('DISPATCH_CONFLICT');
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } }))
      .toMatchObject({ status: 'PENDING_DISPATCH', assignedProviderId: null });
  });

  it('expires waves, tries a second wave, then fails closed with an alert', async () => {
    const order = await createOrder();
    await Promise.all(Array.from({ length: 6 }, (_, index) => createProvider(index + 20, order.startsAt)));
    const waveOne = await dispatch.start(order.id, new Date());
    const afterOne = new Date(Math.max(...waveOne.map((item) => item.expiresAt.getTime())) + 1);
    const waveTwo = await dispatch.expireWave(order.id, afterOne);
    expect(waveTwo).toHaveLength(3);
    expect(waveTwo.every((item) => item.wave === 2)).toBe(true);
    const afterTwo = new Date(Math.max(...waveTwo.map((item) => item.expiresAt.getTime())) + 1);
    expect(await dispatch.expireWave(order.id, afterTwo)).toEqual([]);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } }))
      .toMatchObject({ status: 'DISPATCH_FAILED' });
    expect(alerts).toContainEqual({ orderId: order.id, reason: 'dispatch_exhausted' });
  });
});
