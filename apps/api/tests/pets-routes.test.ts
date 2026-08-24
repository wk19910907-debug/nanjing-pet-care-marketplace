import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { FieldCrypto } from '../src/adapters/field-crypto.js';
import { createApp } from '../src/app.js';
import { PrismaAuditRepository } from '../src/audit/audit-repository.js';
import type { ActorContext, AuthService } from '../src/auth/auth-service.js';
import { createDb } from '../src/db.js';
import { AddressService } from '../src/pets/address-service.js';
import { PetService } from '../src/pets/pet-service.js';

const prisma = createDb(process.env.DATABASE_URL);

class HeaderAuth implements AuthService {
  public async authenticate(value: string | undefined): Promise<ActorContext> {
    if (!value?.startsWith('Bearer ')) throw new Error('UNAUTHENTICATED');
    return { userId: value.slice(7), role: 'OWNER' };
  }
}

describe('pet and address routes', () => {
  const crypto = FieldCrypto.fromBase64(Buffer.alloc(32, 12).toString('base64'), 1);
  const app = createApp({
    auth: new HeaderAuth(),
    pets: new PetService(prisma, crypto),
    addresses: new AddressService(prisma, crypto, new PrismaAuditRepository(prisma)),
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('creates and lists owner pets through authenticated routes', async () => {
    const owner = await prisma.user.create({ data: { role: 'OWNER', phoneHash: randomUUID() } });
    const created = await app.inject({
      method: 'POST', url: '/v1/pets', headers: { authorization: `Bearer ${owner.id}` },
      payload: { name: '团子', species: 'CAT', sensitiveNotes: '' },
    });
    expect(created.statusCode).toBe(201);
    const listed = await app.inject({
      method: 'GET', url: '/v1/pets', headers: { authorization: `Bearer ${owner.id}` },
    });
    expect(listed.json()).toEqual([
      expect.objectContaining({ name: '团子', species: 'CAT' }),
    ]);
  });

  it('rejects invalid address payloads before encryption', async () => {
    const owner = await prisma.user.create({ data: { role: 'OWNER', phoneHash: randomUUID() } });
    const response = await app.inject({
      method: 'POST', url: '/v1/addresses', headers: { authorization: `Bearer ${owner.id}` },
      payload: { city: '南京市', district: '', latitude: 999 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('requires authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/pets' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: 'UNAUTHENTICATED' });
  });
});
