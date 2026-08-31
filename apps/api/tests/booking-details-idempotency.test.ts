import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FieldCrypto } from '../src/adapters/field-crypto.js';
import { createApp } from '../src/app.js';
import { PrismaAuditRepository } from '../src/audit/audit-repository.js';
import type { ActorContext, AuthService } from '../src/auth/auth-service.js';
import { AddressService } from '../src/pets/address-service.js';
import { PetService } from '../src/pets/pet-service.js';

const execFileAsync = promisify(execFile);
const databaseName = `petcare_booking_details_${randomUUID().replaceAll('-', '')}`;
const databaseBaseUrl = process.env.DATABASE_URL
  ?? 'postgresql://petcare:petcare@127.0.0.1:54329/petcare';
const adminUrl = new URL(databaseBaseUrl);
adminUrl.pathname = '/postgres';
const testUrl = new URL(databaseBaseUrl);
testUrl.pathname = `/${databaseName}`;
const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
let prisma: PrismaClient;

const prismaCli = fileURLToPath(new URL('../../../node_modules/prisma/build/index.js', import.meta.url));
const schemaPath = fileURLToPath(new URL('../../../prisma/schema.prisma', import.meta.url));
const fieldCrypto = FieldCrypto.fromBase64(Buffer.alloc(32, 23).toString('base64'), 1);

class HeaderAuth implements AuthService {
  public async authenticate(value: string | undefined): Promise<ActorContext> {
    const match = /^Bearer ([0-9a-f-]+):(OWNER|PROVIDER)$/.exec(value ?? '');
    if (!match) throw new Error('UNAUTHENTICATED');
    return { userId: match[1]!, role: match[2]! as ActorContext['role'] };
  }
}

async function createUser(role: 'OWNER' | 'PROVIDER' = 'OWNER') {
  return prisma.user.create({ data: { role, phoneHash: randomUUID() } });
}

function petInput(clientRequestId?: string) {
  return {
    name: ' 团子 ', species: 'CAT' as const, sensitiveNotes: '对鸡肉过敏', clientRequestId,
  };
}

function addressInput(clientRequestId?: string) {
  return {
    city: '南京市', district: '建邺区', serviceZone: '奥体东', latitude: 32.0123, longitude: 118.7356,
    detail: ' 江东中路100号8栋1201 ', accessInstructions: '门锁密码 135790', clientRequestId,
  };
}

describe('booking profile idempotency', () => {
  beforeAll(async () => {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    await execFileAsync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schemaPath], {
      env: { ...process.env, DATABASE_URL: testUrl.toString() },
    });
    prisma = new PrismaClient({ datasourceUrl: testUrl.toString() });
    await prisma.$connect();
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`,
    );
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.$disconnect();
  });

  it('returns one pet for concurrent same-key normalized requests', async () => {
    const owner = await createUser();
    const clients = [
      new PrismaClient({ datasourceUrl: testUrl.toString() }),
      new PrismaClient({ datasourceUrl: testUrl.toString() }),
    ];
    try {
      await Promise.all(clients.map((client) => client.$connect()));
      const created = await Promise.all(clients.map((client) => new PetService(client, fieldCrypto).create(
        { userId: owner.id, role: 'OWNER' }, petInput('pet-create-1'),
      )));
      expect(new Set(created.map((pet) => pet.id))).toHaveLength(1);
      expect(await prisma.pet.count({ where: { ownerId: owner.id } })).toBe(1);
      expect(created[0]).toMatchObject({ name: '团子', sensitiveNotes: '对鸡肉过敏' });
    } finally {
      await Promise.all(clients.map((client) => client.$disconnect()));
    }
  });

  it('rejects a same-key pet payload conflict without overwriting the original', async () => {
    const owner = await createUser();
    const service = new PetService(prisma, fieldCrypto);
    const original = await service.create({ userId: owner.id, role: 'OWNER' }, petInput('pet-conflict-1'));
    await expect(service.create({ userId: owner.id, role: 'OWNER' }, {
      ...petInput('pet-conflict-1'), sensitiveNotes: '需要单独喂药',
    })).rejects.toThrow('PROFILE_REQUEST_CONFLICT');
    expect(await service.list({ userId: owner.id, role: 'OWNER' })).toEqual([
      expect.objectContaining({ id: original.id, sensitiveNotes: '对鸡肉过敏' }),
    ]);
  });

  it('scopes request ids to the owner and keeps legacy profile creation compatible', async () => {
    const first = await createUser();
    const second = await createUser();
    const service = new PetService(prisma, fieldCrypto);
    await service.create({ userId: first.id, role: 'OWNER' }, petInput('shared-key'));
    await service.create({ userId: second.id, role: 'OWNER' }, petInput('shared-key'));
    await service.create({ userId: first.id, role: 'OWNER' }, petInput());
    await service.create({ userId: first.id, role: 'OWNER' }, petInput());
    expect(await prisma.pet.count({ where: { ownerId: first.id } })).toBe(3);
    expect(await prisma.pet.count({ where: { ownerId: second.id } })).toBe(1);
  });

  it('keeps legacy address creation compatible when no request id is supplied', async () => {
    const owner = await createUser();
    const service = new AddressService(prisma, fieldCrypto, new PrismaAuditRepository(prisma));
    await service.create({ userId: owner.id, role: 'OWNER' }, addressInput());
    await service.create({ userId: owner.id, role: 'OWNER' }, addressInput());
    expect(await prisma.serviceAddress.count({ where: { ownerId: owner.id } })).toBe(2);
  });

  it('returns one address for concurrent same-key requests and lists only decrypted owner detail', async () => {
    const first = await createUser();
    const second = await createUser();
    const clients = [
      new PrismaClient({ datasourceUrl: testUrl.toString() }),
      new PrismaClient({ datasourceUrl: testUrl.toString() }),
    ];
    try {
      await Promise.all(clients.map((client) => client.$connect()));
      const created = await Promise.all(clients.map((client) => new AddressService(
        client, fieldCrypto, new PrismaAuditRepository(client),
      ).create({ userId: first.id, role: 'OWNER' }, addressInput('address-create-1'))));
      expect(new Set(created.map((address) => address.id))).toHaveLength(1);
    } finally {
      await Promise.all(clients.map((client) => client.$disconnect()));
    }
    const service = new AddressService(prisma, fieldCrypto, new PrismaAuditRepository(prisma));
    await service.create({ userId: second.id, role: 'OWNER' }, addressInput('address-create-1'));
    const listed = await service.list({ userId: first.id, role: 'OWNER' });
    expect(listed).toEqual([expect.objectContaining({ detail: '江东中路100号8栋1201' })]);
    expect(listed[0]).not.toHaveProperty('accessInstructions');
    expect(listed[0]).not.toHaveProperty('detailCiphertext');
    expect(await prisma.serviceAddress.count({ where: { ownerId: first.id } })).toBe(1);
    expect(await prisma.serviceAddress.count({ where: { ownerId: second.id } })).toBe(1);
  });

  it('rejects a same-key address payload conflict without overwriting the original', async () => {
    const owner = await createUser();
    const service = new AddressService(prisma, fieldCrypto, new PrismaAuditRepository(prisma));
    const original = await service.create(
      { userId: owner.id, role: 'OWNER' }, addressInput('address-conflict-1'),
    );
    await expect(service.create({ userId: owner.id, role: 'OWNER' }, {
      ...addressInput('address-conflict-1'), detail: '江东中路100号8栋1202',
    })).rejects.toThrow('PROFILE_REQUEST_CONFLICT');
    expect(await service.list({ userId: owner.id, role: 'OWNER' })).toEqual([
      expect.objectContaining({ id: original.id, detail: '江东中路100号8栋1201' }),
    ]);
  });

  it('keeps OWNER role gates on profile create and list', async () => {
    const owner = await createUser();
    const staff = await createUser('PROVIDER');
    const pets = new PetService(prisma, fieldCrypto);
    const addresses = new AddressService(prisma, fieldCrypto, new PrismaAuditRepository(prisma));
    await expect(pets.create({ userId: staff.id, role: 'PROVIDER' }, petInput('staff-pet')))
      .rejects.toThrow('FORBIDDEN');
    await expect(addresses.create({ userId: staff.id, role: 'PROVIDER' }, addressInput('staff-address')))
      .rejects.toThrow('FORBIDDEN');
    await addresses.create({ userId: owner.id, role: 'OWNER' }, addressInput());
    await expect(addresses.list({ userId: staff.id, role: 'PROVIDER' })).rejects.toThrow('FORBIDDEN');
  });

  it('validates request ids, maps conflicts to 409, and sends no-store for address lists', async () => {
    const owner = await createUser();
    const app = createApp({
      auth: new HeaderAuth(),
      pets: new PetService(prisma, fieldCrypto),
      addresses: new AddressService(prisma, fieldCrypto, new PrismaAuditRepository(prisma)),
    });
    try {
      const authorization = `Bearer ${owner.id}:OWNER`;
      for (const clientRequestId of ['', '中文', 'a'.repeat(101), 'key with space']) {
        const response = await app.inject({
          method: 'POST', url: '/v1/pets', headers: { authorization },
          payload: petInput(clientRequestId),
        });
        expect(response.statusCode).toBe(400);
      }
      const created = await app.inject({
        method: 'POST', url: '/v1/addresses', headers: { authorization },
        payload: addressInput('route-address-1'),
      });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toEqual(expect.objectContaining({
        city: '南京市', district: '建邺区', serviceZone: '奥体东', detail: '江东中路100号8栋1201',
      }));
      expect(created.json()).not.toHaveProperty('accessInstructions');
      expect(created.json()).not.toHaveProperty('detailCiphertext');
      const conflict = await app.inject({
        method: 'POST', url: '/v1/addresses', headers: { authorization },
        payload: { ...addressInput('route-address-1'), detail: '江东中路100号8栋1202' },
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json()).toEqual({ code: 'PROFILE_REQUEST_CONFLICT' });
      const list = await app.inject({ method: 'GET', url: '/v1/addresses', headers: { authorization } });
      expect(list.headers['cache-control']).toBe('no-store');
      expect(list.json()).toEqual([expect.objectContaining({ detail: '江东中路100号8栋1201' })]);
      const staff = await createUser('PROVIDER');
      const forbidden = await app.inject({
        method: 'POST', url: '/v1/pets', headers: { authorization: `Bearer ${staff.id}:PROVIDER` },
        payload: petInput('staff-route-pet'),
      });
      expect(forbidden.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});
