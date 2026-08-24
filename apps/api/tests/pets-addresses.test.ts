import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { FieldCrypto } from '../src/adapters/field-crypto.js';
import { PrismaAuditRepository } from '../src/audit/audit-repository.js';
import { createDb } from '../src/db.js';
import { AddressService } from '../src/pets/address-service.js';
import { PetService } from '../src/pets/pet-service.js';

const prisma = createDb(process.env.DATABASE_URL);
const fieldCrypto = FieldCrypto.fromBase64(Buffer.alloc(32, 9).toString('base64'), 1);
const audit = new PrismaAuditRepository(prisma);
const pets = new PetService(prisma, fieldCrypto);
const addresses = new AddressService(prisma, fieldCrypto, audit);

async function owner() {
  return prisma.user.create({ data: { role: 'OWNER', phoneHash: randomUUID() } });
}

describe('pet and address ownership', () => {
  afterAll(async () => prisma.$disconnect());

  it('creates and lists only the current owner pets', async () => {
    const first = await owner();
    const second = await owner();
    const pet = await pets.create({ userId: first.id, role: 'OWNER' }, {
      name: '汤圆', species: 'CAT', sensitiveNotes: '对鸡肉过敏',
    });
    await pets.create({ userId: second.id, role: 'OWNER' }, {
      name: '豆豆', species: 'DOG', sensitiveNotes: '',
    });

    expect(await pets.list({ userId: first.id, role: 'OWNER' })).toEqual([
      expect.objectContaining({ id: pet.id, name: '汤圆', species: 'CAT' }),
    ]);
    await expect(pets.rename({ userId: second.id, role: 'OWNER' }, pet.id, '非法修改'))
      .rejects.toThrow('FORBIDDEN');
  });

  it('stores address details encrypted and never returns access instructions in lists', async () => {
    const current = await owner();
    const address = await addresses.create({ userId: current.id, role: 'OWNER' }, {
      city: '南京市', district: '建邺区', serviceZone: '奥体东',
      latitude: 32.0123, longitude: 118.7356,
      detail: '江东中路100号8栋1201', accessInstructions: '门锁密码 135790',
    });
    const stored = await prisma.serviceAddress.findUniqueOrThrow({ where: { id: address.id } });
    expect(Buffer.from(stored.detailCiphertext).toString('utf8')).not.toContain('江东中路100号');
    expect(Buffer.from(stored.accessCiphertext ?? []).toString('utf8')).not.toContain('135790');
    expect(await addresses.list({ userId: current.id, role: 'OWNER' })).toEqual([
      expect.objectContaining({ id: address.id, city: '南京市', district: '建邺区' }),
    ]);
    expect(await addresses.list({ userId: current.id, role: 'OWNER' }))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ accessInstructions: expect.anything() })]));
  });
});
