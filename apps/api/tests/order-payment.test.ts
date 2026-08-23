import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { PricingPolicy } from '@pet/domain';
import { FieldCrypto } from '../src/adapters/field-crypto.js';
import { FakePaymentGateway } from '../src/adapters/fake-payment-gateway.js';
import { createApp } from '../src/app.js';
import { PrismaAuditRepository } from '../src/audit/audit-repository.js';
import type { ActorContext, AuthService } from '../src/auth/auth-service.js';
import { QuoteService } from '../src/catalog/quote-service.js';
import { createDb } from '../src/db.js';
import { OrderService } from '../src/orders/order-service.js';
import { PaymentService } from '../src/payments/payment-service.js';
import { AddressService } from '../src/pets/address-service.js';
import { PetService } from '../src/pets/pet-service.js';

const prisma = createDb(process.env.DATABASE_URL);
const policy: PricingPolicy = {
  baseFen: { CAT_FEEDING: 3900, DOG_WALKING: 4900 }, includedPets: 1,
  extraPetFen: 1000, includedMinutes: { CAT_FEEDING: 30, DOG_WALKING: 30 },
  extraDurationBlockMinutes: 20, extraDurationBlockFen: 700,
  includedDistanceKm: 3, extraDistanceKmFen: 200, holidayMultiplierBps: 15000,
};

class HeaderAuth implements AuthService {
  public async authenticate(value: string | undefined): Promise<ActorContext> {
    if (!value?.startsWith('Bearer ')) throw new Error('UNAUTHENTICATED');
    return { userId: value.slice(7), role: 'OWNER' };
  }
}

describe('quote, order and payment gate', () => {
  const crypto = FieldCrypto.fromBase64(Buffer.alloc(32, 13).toString('base64'), 1);
  const audit = new PrismaAuditRepository(prisma);
  const pets = new PetService(prisma, crypto);
  const addresses = new AddressService(prisma, crypto, audit);
  const quotes = new QuoteService(prisma, policy, { distanceKm: async () => 3 }, { isHoliday: () => false });
  const gateway = new FakePaymentGateway('test-webhook-secret');
  const orders = new OrderService(prisma, quotes, gateway, audit);
  const payments = new PaymentService(prisma, gateway, audit);
  const app = createApp({ auth: new HeaderAuth(), pets, addresses, quotes, orders, payments });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function fixture() {
    const owner = await prisma.user.create({ data: { role: 'OWNER', phoneHash: randomUUID() } });
    const pet = await pets.create({ userId: owner.id, role: 'OWNER' }, {
      name: '汤圆', species: 'CAT', sensitiveNotes: '',
    });
    const address = await addresses.create({ userId: owner.id, role: 'OWNER' }, {
      city: '南京市', district: '建邺区', serviceZone: '奥体东',
      latitude: 32.0123, longitude: 118.7356, detail: '测试地址', accessInstructions: '',
    });
    return { owner, pet, address };
  }

  it('prices from trusted records and ignores a client supplied total', async () => {
    const { owner, pet, address } = await fixture();
    const response = await app.inject({
      method: 'POST', url: '/v1/quotes', headers: { authorization: `Bearer ${owner.id}` },
      payload: {
        serviceType: 'CAT_FEEDING', petIds: [pet.id], addressId: address.id,
        startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30,
        totalFen: 1,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ totalFen: 3900, currency: 'CNY' });
  });

  it('creates one pending-payment order for repeated identical idempotency requests', async () => {
    const { owner, pet, address } = await fixture();
    const key = randomUUID();
    const payload = {
      serviceType: 'CAT_FEEDING', petIds: [pet.id], addressId: address.id,
      startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30,
      notes: '',
    };
    const first = await app.inject({
      method: 'POST', url: '/v1/orders',
      headers: { authorization: `Bearer ${owner.id}`, 'idempotency-key': key }, payload,
    });
    const second = await app.inject({
      method: 'POST', url: '/v1/orders',
      headers: { authorization: `Bearer ${owner.id}`, 'idempotency-key': key }, payload,
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(first.json()).toMatchObject({ status: 'PENDING_PAYMENT', totalFen: 3900 });
    expect(await prisma.order.count({ where: { ownerId: owner.id, idempotencyKey: key } })).toBe(1);
  });

  it('moves an order to dispatch exactly once after a verified matching webhook', async () => {
    const { owner, pet, address } = await fixture();
    const created = await app.inject({
      method: 'POST', url: '/v1/orders',
      headers: { authorization: `Bearer ${owner.id}`, 'idempotency-key': randomUUID() },
      payload: {
        serviceType: 'CAT_FEEDING', petIds: [pet.id], addressId: address.id,
        startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30,
        notes: '',
      },
    });
    const event = gateway.successEvent(created.json().id, 3900);
    const first = await app.inject({
      method: 'POST', url: '/v1/payments/webhooks/fake',
      headers: { 'x-payment-signature': gateway.sign(event) }, payload: event,
    });
    const replay = await app.inject({
      method: 'POST', url: '/v1/payments/webhooks/fake',
      headers: { 'x-payment-signature': gateway.sign(event) }, payload: event,
    });
    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: created.json().id } }))
      .toMatchObject({ status: 'PENDING_DISPATCH', version: 1 });
  });

  it('rejects amount-mismatched and unsigned payment events', async () => {
    const { owner, pet, address } = await fixture();
    const created = await app.inject({
      method: 'POST', url: '/v1/orders',
      headers: { authorization: `Bearer ${owner.id}`, 'idempotency-key': randomUUID() },
      payload: {
        serviceType: 'CAT_FEEDING', petIds: [pet.id], addressId: address.id,
        startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30,
        notes: '',
      },
    });
    const event = gateway.successEvent(created.json().id, 1);
    const mismatch = await app.inject({
      method: 'POST', url: '/v1/payments/webhooks/fake',
      headers: { 'x-payment-signature': gateway.sign(event) }, payload: event,
    });
    const unsigned = await app.inject({
      method: 'POST', url: '/v1/payments/webhooks/fake', payload: event,
    });
    expect(mismatch.statusCode).toBe(400);
    expect(unsigned.statusCode).toBe(400);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: created.json().id } }))
      .toMatchObject({ status: 'PENDING_PAYMENT', version: 0 });
  });
});
