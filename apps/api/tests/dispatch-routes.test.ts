import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { FieldCrypto } from '../src/adapters/field-crypto.js';
import { createApp } from '../src/app.js';
import { PrismaAuditRepository } from '../src/audit/audit-repository.js';
import type { ActorContext, AuthService } from '../src/auth/auth-service.js';
import { createDb } from '../src/db.js';
import { DispatchService } from '../src/dispatch/dispatch-service.js';
import { ProviderService } from '../src/dispatch/provider-service.js';
import { AddressService } from '../src/pets/address-service.js';
import { PetService } from '../src/pets/pet-service.js';

const prisma = createDb(process.env.DATABASE_URL);

class DatabaseHeaderAuth implements AuthService {
  public async authenticate(value: string | undefined): Promise<ActorContext> {
    if (!value?.startsWith('Bearer ')) throw new Error('UNAUTHENTICATED');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: value.slice(7) } });
    return { userId: user.id, role: user.role };
  }
}

describe('dispatch routes', () => {
  const audit = new PrismaAuditRepository(prisma);
  const crypto = FieldCrypto.fromBase64(Buffer.alloc(32, 7).toString('base64'), 1);
  const app = createApp({
    auth: new DatabaseHeaderAuth(),
    pets: new PetService(prisma, crypto),
    addresses: new AddressService(prisma, crypto, audit),
    providers: new ProviderService(prisma, audit),
    dispatch: new DispatchService(prisma, audit, { notify: async () => undefined }),
  });

  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it('accepts a provider application and availability through authenticated routes', async () => {
    const user = await prisma.user.create({ data: { role: 'PROVIDER', phoneHash: randomUUID() } });
    const application = await app.inject({
      method: 'POST', url: '/v1/providers/applications',
      headers: { authorization: `Bearer ${user.id}` },
      payload: {
        serviceTypes: ['DOG_WALKING'], serviceZone: '百家湖',
        latitude: 31.94, longitude: 118.82, radiusKm: 4,
        catExperienceMonths: 0, dogExperienceMonths: 24,
      },
    });
    expect(application.statusCode).toBe(201);
    expect(application.json()).toEqual({ id: expect.any(String), reviewStatus: 'PENDING' });
    const profileId = application.json<{ id: string }>().id;

    const startsAt = new Date(Date.now() + 86_400_000);
    const availability = await app.inject({
      method: 'POST', url: '/v1/providers/availability',
      headers: { authorization: `Bearer ${user.id}` },
      payload: { startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString() },
    });
    expect(availability.statusCode).toBe(201);
    expect(availability.json()).toEqual({
      id: expect.any(String), startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
    });

    const admin = await prisma.user.create({ data: { role: 'ADMIN', phoneHash: randomUUID() } });
    const reviewed = await app.inject({
      method: 'POST', url: `/v1/providers/${profileId}/review`,
      headers: { authorization: `Bearer ${admin.id}` }, payload: { status: 'APPROVED' },
    });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json()).toEqual({ id: profileId, reviewStatus: 'APPROVED' });

    const owner = await prisma.user.create({ data: { role: 'OWNER', phoneHash: randomUUID() } });
    const address = await prisma.serviceAddress.create({ data: {
      ownerId: owner.id, city: '南京市', district: '江宁区', serviceZone: '百家湖',
      latitude: 31.94, longitude: 118.82, detailCiphertext: new Uint8Array([1]),
      detailNonce: new Uint8Array([1]), detailAuthTag: new Uint8Array([1]), encryptionKeyVersion: 1,
    }});
    const order = await prisma.order.create({ data: {
      ownerId: owner.id, addressId: address.id, idempotencyKey: randomUUID(),
      serviceType: 'DOG_WALKING', status: 'PENDING_DISPATCH', startsAt,
      durationMinutes: 30, quoteSnapshot: { totalFen: 3900 }, totalFen: 3900,
    }});
    const dispatched = await app.inject({
      method: 'POST', url: `/v1/dispatch/${order.id}/start`,
      headers: { authorization: `Bearer ${admin.id}` },
    });
    expect(dispatched.statusCode).toBe(200);
    expect(dispatched.json()).toEqual([{
      id: expect.any(String), status: 'PENDING', expiresAt: expect.any(String),
    }]);
    const invitationId = dispatched.json<Array<{ id: string }>>()[0]!.id;
    const accepted = await app.inject({
      method: 'POST', url: `/v1/invitations/${invitationId}/accept`,
      headers: { authorization: `Bearer ${user.id}` },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ id: order.id, status: 'PENDING_SERVICE' });
  });
});
