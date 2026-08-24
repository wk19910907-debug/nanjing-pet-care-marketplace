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
    expect(application.json()).toMatchObject({ reviewStatus: 'PENDING', serviceZone: '百家湖' });

    const startsAt = new Date(Date.now() + 86_400_000);
    const availability = await app.inject({
      method: 'POST', url: '/v1/providers/availability',
      headers: { authorization: `Bearer ${user.id}` },
      payload: { startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString() },
    });
    expect(availability.statusCode).toBe(201);
  });
});
