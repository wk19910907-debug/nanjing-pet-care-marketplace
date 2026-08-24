import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { FieldCrypto } from '../src/adapters/field-crypto.js';
import { PrismaAuditRepository } from '../src/audit/audit-repository.js';
import { createDb } from '../src/db.js';
import { AddressService } from '../src/pets/address-service.js';

const prisma = createDb(process.env.DATABASE_URL);
const fieldCrypto = FieldCrypto.fromBase64(Buffer.alloc(32, 11).toString('base64'), 1);
const addresses = new AddressService(prisma, fieldCrypto, new PrismaAuditRepository(prisma));

describe('sensitive address access', () => {
  afterAll(async () => prisma.$disconnect());

  it('gives invited candidates only an approximate view', async () => {
    const owner = await prisma.user.create({ data: { role: 'OWNER', phoneHash: randomUUID() } });
    const providerUser = await prisma.user.create({ data: { role: 'PROVIDER', phoneHash: randomUUID() } });
    const provider = await prisma.providerProfile.create({ data: {
      userId: providerUser.id, reviewStatus: 'APPROVED', serviceTypes: ['CAT_FEEDING'],
      serviceZone: '奥体东', latitude: 32.01, longitude: 118.73, radiusKm: 5,
    }});
    const address = await addresses.create({ userId: owner.id, role: 'OWNER' }, {
      city: '南京市', district: '建邺区', serviceZone: '奥体东', latitude: 32.0123,
      longitude: 118.7356, detail: '江东中路100号8栋1201', accessInstructions: '密码135790',
    });
    const order = await prisma.order.create({ data: {
      ownerId: owner.id, addressId: address.id, idempotencyKey: randomUUID(),
      serviceType: 'CAT_FEEDING', status: 'PENDING_DISPATCH',
      startsAt: new Date(Date.now() + 3_600_000), durationMinutes: 30,
      quoteSnapshot: { totalFen: 3900 }, totalFen: 3900,
    }});
    await prisma.dispatchInvitation.create({ data: {
      orderId: order.id, providerId: provider.id, wave: 1,
      expiresAt: new Date(Date.now() + 300_000),
    }});

    await expect(addresses.getCandidateView(order.id, providerUser.id)).resolves.toEqual({
      city: '南京市', district: '建邺区', serviceZone: '奥体东', approximateDistanceKm: 0.6,
    });
  });

  it('reveals full details only to the assigned provider in the access window and audits it', async () => {
    const owner = await prisma.user.create({ data: { role: 'OWNER', phoneHash: randomUUID() } });
    const providerUser = await prisma.user.create({ data: { role: 'PROVIDER', phoneHash: randomUUID() } });
    const provider = await prisma.providerProfile.create({ data: {
      userId: providerUser.id, reviewStatus: 'APPROVED', serviceTypes: ['DOG_WALKING'],
      serviceZone: '奥体东', latitude: 32.01, longitude: 118.73, radiusKm: 5,
    }});
    const address = await addresses.create({ userId: owner.id, role: 'OWNER' }, {
      city: '南京市', district: '建邺区', serviceZone: '奥体东', latitude: 32.0123,
      longitude: 118.7356, detail: '江东中路100号8栋1201', accessInstructions: '钥匙在物业',
    });
    const startsAt = new Date(Date.now() + 30 * 60_000);
    const order = await prisma.order.create({ data: {
      ownerId: owner.id, addressId: address.id, assignedProviderId: provider.id,
      idempotencyKey: randomUUID(), serviceType: 'DOG_WALKING', status: 'PENDING_SERVICE',
      startsAt, durationMinutes: 30, quoteSnapshot: { totalFen: 4900 }, totalFen: 4900,
    }});

    await expect(addresses.getAssignedProviderView(order.id, providerUser.id, new Date()))
      .resolves.toMatchObject({ detail: '江东中路100号8栋1201', accessInstructions: '钥匙在物业' });
    expect(await prisma.auditEvent.count({ where: {
      action: 'SENSITIVE_ADDRESS_VIEWED', entityId: address.id, actorId: providerUser.id,
    }})).toBe(1);
    await expect(addresses.getAssignedProviderView(
      order.id, providerUser.id, new Date(startsAt.getTime() - 61 * 60_000),
    )).rejects.toThrow('FORBIDDEN');
  });
});
