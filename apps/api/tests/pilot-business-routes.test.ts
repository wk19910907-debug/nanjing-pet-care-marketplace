import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import type { PricingPolicy } from '@pet/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PilotManualPaymentGateway } from '../src/adapters/pilot-manual-payment-gateway.js';
import { createApp } from '../src/app.js';
import { PrismaAuditRepository } from '../src/audit/audit-repository.js';
import type { ActorContext, AuthService } from '../src/auth/auth-service.js';
import { QuoteService } from '../src/catalog/quote-service.js';
import { OrderService } from '../src/orders/order-service.js';
import { ManualFeeService } from '../src/pilot/manual-fee-service.js';
import { PilotReadModel } from '../src/pilot/pilot-read-model.js';

const execFileAsync = promisify(execFile);
const databaseName = `petcare_pilot_business_${randomUUID().replaceAll('-', '')}`;
const databaseBaseUrl = process.env.DATABASE_URL
  ?? 'postgresql://petcare:petcare@127.0.0.1:54329/petcare';
const adminUrl = new URL(databaseBaseUrl);
adminUrl.pathname = '/postgres';
const testUrl = new URL(databaseBaseUrl);
testUrl.pathname = `/${databaseName}`;

const adminClient = new PrismaClient({ datasourceUrl: adminUrl.toString() });
let prisma: PrismaClient;

const prismaCli = fileURLToPath(new URL('../../../node_modules/prisma/build/index.js', import.meta.url));
const schemaPath = fileURLToPath(new URL('../../../prisma/schema.prisma', import.meta.url));

const policy: PricingPolicy = {
  baseFen: { CAT_FEEDING: 3900, DOG_WALKING: 4900 },
  includedPets: 1,
  extraPetFen: 1000,
  includedMinutes: { CAT_FEEDING: 30, DOG_WALKING: 30 },
  extraDurationBlockMinutes: 20,
  extraDurationBlockFen: 700,
  includedDistanceKm: 3,
  extraDistanceKmFen: 200,
  holidayMultiplierBps: 10_000,
};

class DatabaseHeaderAuth implements AuthService {
  public async authenticate(value: string | undefined): Promise<ActorContext> {
    if (!value?.startsWith('Bearer ')) throw new Error('UNAUTHENTICATED');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: value.slice(7) } });
    return { userId: user.id, role: user.role };
  }
}

async function createUser(role: 'OWNER' | 'PROVIDER' | 'ADMIN', displayName: string) {
  const user = await prisma.user.create({ data: { role, displayName } });
  return { user, actor: { userId: user.id, role } satisfies ActorContext };
}

async function createProvider(displayName: string, serviceZone: string) {
  const { user, actor } = await createUser('PROVIDER', displayName);
  const profile = await prisma.providerProfile.create({
    data: {
      userId: user.id,
      reviewStatus: 'PENDING',
      serviceTypes: ['CAT_FEEDING'],
      serviceZone,
      latitude: 32.01,
      longitude: 118.73,
      radiusKm: 5,
      catExperienceMonths: 18,
      dogExperienceMonths: 0,
    },
  });
  return { user, actor, profile };
}

async function createOrderFixture(input: {
  ownerName: string;
  serviceZone: string;
  notes: string;
  status?: 'PENDING_PAYMENT' | 'PENDING_DISPATCH' | 'PENDING_SERVICE';
  assignedProviderId?: string;
}) {
  const { user: owner, actor } = await createUser('OWNER', input.ownerName);
  const pet = await prisma.pet.create({
    data: { ownerId: owner.id, name: '汤圆', species: 'CAT_FEEDING' },
  });
  const address = await prisma.serviceAddress.create({
    data: {
      ownerId: owner.id,
      city: '南京市',
      district: '建邺区',
      serviceZone: input.serviceZone,
      latitude: 32.01,
      longitude: 118.73,
      detailCiphertext: Buffer.from('address-ciphertext-sentinel'),
      detailNonce: Buffer.from('address-nonce-sentinel'),
      detailAuthTag: Buffer.from('address-auth-tag-sentinel'),
      accessCiphertext: Buffer.from('access-ciphertext-sentinel'),
      accessNonce: Buffer.from('access-nonce-sentinel'),
      accessAuthTag: Buffer.from('access-auth-tag-sentinel'),
      encryptionKeyVersion: 1,
    },
  });
  const order = await prisma.order.create({
    data: {
      ownerId: owner.id,
      addressId: address.id,
      assignedProviderId: input.assignedProviderId ?? null,
      idempotencyKey: randomUUID(),
      serviceType: 'CAT_FEEDING',
      status: input.status ?? 'PENDING_PAYMENT',
      startsAt: new Date('2026-09-01T08:00:00.000Z'),
      durationMinutes: 30,
      notes: input.notes,
      quoteSnapshot: { totalFen: 3900 },
      totalFen: 3900,
      pets: { create: { petId: pet.id } },
      payment: {
        create: {
          provider: 'pilot-manual',
          providerPaymentId: `pilot-manual-${randomUUID()}`,
          amountFen: 3900,
        },
      },
    },
  });
  return { owner, actor, pet, address, order };
}

describe('pilot manual fee and role-filtered business routes', () => {
  beforeAll(async () => {
    await adminClient.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    await execFileAsync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schemaPath], {
      env: { ...process.env, DATABASE_URL: testUrl.toString() },
    });
    prisma = new PrismaClient({ datasourceUrl: testUrl.toString() });
    await prisma.$connect();
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await adminClient.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`,
    );
    await adminClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await adminClient.$disconnect();
  });

  it('uses a manual gateway without creating a browser payment token', async () => {
    const gateway = new PilotManualPaymentGateway();
    const created = await gateway.createPayment({
      orderId: randomUUID(), amountFen: 3900, currency: 'CNY',
    });

    expect(gateway.providerName).toBe('pilot-manual');
    expect(created.providerPaymentId).toMatch(/^pilot-manual-/);
    expect(created.paymentToken).toBeNull();
    expect(() => gateway.verifyWebhook({}, undefined)).toThrow('PAYMENT_VERIFICATION_FAILED');
    await expect(gateway.refund({ orderId: randomUUID(), amountFen: 100, reason: 'test' }))
      .rejects.toThrow('MANUAL_REFUND_REQUIRED');
  });

  it('confirms an offline fee once and rejects unauthorized or conflicting confirmation', async () => {
    const owner = await createOrderFixture({
      ownerName: '宠主甲', serviceZone: '奥体东', notes: '猫粮在餐桌旁',
    });
    const { actor: admin } = await createUser('ADMIN', '运营甲');
    const fees = new ManualFeeService(prisma, new PrismaAuditRepository(prisma));

    await expect(fees.confirm(owner.actor, owner.order.id, 'manual-fee-0001'))
      .rejects.toThrow('FORBIDDEN');
    await expect(fees.confirm(admin, owner.order.id, 'short'))
      .rejects.toThrow('VALIDATION_ERROR');

    const first = await fees.confirm(admin, owner.order.id, 'manual-fee-0001');
    const replay = await fees.confirm(admin, owner.order.id, 'manual-fee-0001');
    expect(replay.id).toBe(first.id);
    expect(first).not.toHaveProperty('manualConfirmationKey');
    expect(first).not.toHaveProperty('providerEventId');
    await expect(fees.confirm(admin, owner.order.id, 'manual-fee-0002'))
      .rejects.toThrow('MANUAL_FEE_CONFLICT');

    expect(await prisma.payment.count({
      where: { orderId: owner.order.id, status: 'SUCCEEDED' },
    })).toBe(1);
    expect(await prisma.auditEvent.count({
      where: { action: 'MANUAL_FEE_CONFIRMED', entityId: owner.order.id },
    })).toBe(1);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: owner.order.id } }))
      .toMatchObject({ status: 'PENDING_DISPATCH', version: 1 });

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'MANUAL_FEE_CONFIRMED', entityId: owner.order.id },
    });
    expect(audit.metadata).toEqual({ provider: 'pilot-manual', amountFen: 3900 });
    expect(JSON.stringify(audit.metadata)).not.toContain('manual-fee-0001');
  });

  it('returns explicit, role-filtered read objects without address cryptography or contact fields', async () => {
    const providerA = await createProvider('服务者甲', '奥体东');
    const providerB = await createProvider('服务者乙', '新街口');
    const ownerA = await createOrderFixture({
      ownerName: '宠主甲', serviceZone: '奥体东', notes: '只喂指定猫粮',
      status: 'PENDING_DISPATCH',
    });
    const ownerB = await createOrderFixture({
      ownerName: '宠主乙', serviceZone: '新街口', notes: '请轻声敲门',
      status: 'PENDING_SERVICE', assignedProviderId: providerB.profile.id,
    });
    await prisma.dispatchInvitation.createMany({ data: [
      {
        orderId: ownerA.order.id,
        providerId: providerA.profile.id,
        wave: 1,
        expiresAt: new Date('2026-09-01T07:55:00.000Z'),
      },
      {
        orderId: ownerB.order.id,
        providerId: providerB.profile.id,
        wave: 1,
        status: 'ACCEPTED',
        expiresAt: new Date('2026-09-01T07:55:00.000Z'),
      },
    ] });
    const { actor: admin } = await createUser('ADMIN', '运营甲');
    const read = new PilotReadModel(prisma);

    expect(await read.orders(ownerA.actor)).toHaveLength(1);
    expect(JSON.stringify(await read.orders(ownerA.actor))).not.toContain(ownerB.order.id);
    expect(JSON.stringify(await read.orders(providerB.actor))).not.toContain(ownerA.order.id);
    await expect(read.order(ownerA.actor, ownerB.order.id)).rejects.toThrow('FORBIDDEN');
    await expect(read.reviewQueue(ownerA.actor)).rejects.toThrow('FORBIDDEN');

    const candidate = await read.orders(providerA.actor);
    expect(candidate).toEqual([
      expect.objectContaining({
        id: ownerA.order.id,
        serviceType: 'CAT_FEEDING',
        district: '建邺区',
        serviceZone: '奥体东',
        invitation: expect.objectContaining({ status: 'PENDING' }),
      }),
    ]);
    expect(Object.keys(candidate[0]!).sort()).toEqual([
      'city', 'district', 'durationMinutes', 'id', 'invitation', 'serviceType', 'serviceZone',
      'startsAt',
    ]);
    const candidateJson = JSON.stringify(candidate);
    for (const forbidden of [
      'ownerDisplayName', 'providerDisplayName', 'notes', 'detailCiphertext', 'detailNonce',
      'detailAuthTag', 'accessCiphertext', 'accessNonce', 'accessAuthTag', 'phoneHash',
      'wechatOpenId', 'codeHash',
    ]) {
      expect(candidateJson).not.toContain(forbidden);
    }

    const ownerView = await read.order(ownerA.actor, ownerA.order.id);
    const adminView = await read.order(admin, ownerA.order.id);
    expect(ownerView).toMatchObject({ notes: '只喂指定猫粮' });
    expect(adminView).toMatchObject({
      notes: '只喂指定猫粮', ownerDisplayName: '宠主甲',
    });
    const allViews = JSON.stringify([
      ownerView, adminView, await read.orders(providerB.actor), await read.reviewQueue(admin),
    ]);
    for (const forbidden of [
      'detailCiphertext', 'detailNonce', 'detailAuthTag', 'accessCiphertext', 'accessNonce',
      'accessAuthTag', 'phoneHash', 'wechatOpenId',
    ]) {
      expect(allViews).not.toContain(forbidden);
    }
  });

  it('serializes concurrent manual confirmations across independent database clients', async () => {
    const sameKeyOrder = await createOrderFixture({
      ownerName: '并发宠主甲', serviceZone: '奥体东', notes: '',
    });
    const differentKeyOrder = await createOrderFixture({
      ownerName: '并发宠主乙', serviceZone: '奥体东', notes: '',
    });
    const { actor: admin } = await createUser('ADMIN', '并发运营');
    const clients = [
      new PrismaClient({ datasourceUrl: testUrl.toString() }),
      new PrismaClient({ datasourceUrl: testUrl.toString() }),
    ];
    await Promise.all(clients.map((client) => client.$connect()));

    try {
      const services = clients.map((client) => (
        new ManualFeeService(client, new PrismaAuditRepository(client))
      ));
      const sameKey = await Promise.all([
        services[0]!.confirm(admin, sameKeyOrder.order.id, 'concurrent-same-0001'),
        services[1]!.confirm(admin, sameKeyOrder.order.id, 'concurrent-same-0001'),
      ]);
      expect(new Set(sameKey.map((confirmation) => confirmation.id)).size).toBe(1);
      expect(await prisma.auditEvent.count({
        where: { action: 'MANUAL_FEE_CONFIRMED', entityId: sameKeyOrder.order.id },
      })).toBe(1);

      const differentKeys = await Promise.allSettled([
        services[0]!.confirm(admin, differentKeyOrder.order.id, 'concurrent-diff-0001'),
        services[1]!.confirm(admin, differentKeyOrder.order.id, 'concurrent-diff-0002'),
      ]);
      expect(differentKeys.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(differentKeys.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(await prisma.payment.count({
        where: { orderId: differentKeyOrder.order.id, status: 'SUCCEEDED' },
      })).toBe(1);
      expect(await prisma.auditEvent.count({
        where: { action: 'MANUAL_FEE_CONFIRMED', entityId: differentKeyOrder.order.id },
      })).toBe(1);
    } finally {
      await Promise.all(clients.map((client) => client.$disconnect()));
    }
  });

  it('limits and deterministically orders invitation metadata without exposing credentials', async () => {
    const { user: adminUser, actor: admin } = await createUser('ADMIN', '运营乙');
    const read = new PilotReadModel(prisma);
    const createdAt = new Date('2026-08-27T10:00:00.000Z');
    await prisma.pilotInvite.createMany({
      data: Array.from({ length: 105 }, (_, index) => ({
        codeHash: index.toString(16).padStart(64, '0'),
        role: index % 2 === 0 ? 'OWNER' : 'PROVIDER',
        expiresAt: new Date('2026-08-28T10:00:00.000Z'),
        createdById: adminUser.id,
        createdAt,
      })),
    });

    const invites = await read.invites(admin);
    expect(invites).toHaveLength(100);
    expect(invites.map((invite) => invite.id)).toEqual(
      [...invites.map((invite) => invite.id)].sort().reverse(),
    );
    const serialized = JSON.stringify(invites);
    expect(serialized).not.toContain('codeHash');
    expect(serialized).not.toContain('0000000000000000000000000000000000000000000000000000000000000000');
  });

  it('limits order lists without truncating dashboard counts', async () => {
    const owner = await createOrderFixture({
      ownerName: '批量宠主', serviceZone: '奥体东', notes: '',
    });
    await prisma.order.createMany({
      data: Array.from({ length: 100 }, (_, index) => ({
        ownerId: owner.owner.id,
        addressId: owner.address.id,
        idempotencyKey: `bulk-order-${index.toString().padStart(3, '0')}-${randomUUID()}`,
        serviceType: 'CAT_FEEDING',
        status: 'PENDING_PAYMENT',
        startsAt: new Date('2026-09-01T08:00:00.000Z'),
        durationMinutes: 30,
        notes: '',
        quoteSnapshot: { totalFen: 3900 },
        totalFen: 3900,
      })),
    });
    const read = new PilotReadModel(prisma);

    expect(await read.orders(owner.actor)).toHaveLength(100);
    expect(await read.dashboard(owner.actor)).toEqual({
      role: 'OWNER',
      counts: { orders: 101 },
      todos: { pendingPayment: 101, pendingConfirmation: 0 },
    });
  });

  it('returns null from the existing order route when the pilot gateway creates the payment', async () => {
    const owner = await createOrderFixture({
      ownerName: '下单宠主', serviceZone: '奥体东', notes: '',
    });
    await prisma.payment.delete({ where: { orderId: owner.order.id } });
    await prisma.orderPet.deleteMany({ where: { orderId: owner.order.id } });
    await prisma.order.delete({ where: { id: owner.order.id } });
    const quotes = new QuoteService(
      prisma,
      policy,
      { distanceKm: async () => 0 },
      { isHoliday: () => false },
    );
    const gateway = new PilotManualPaymentGateway();
    const orders = new OrderService(prisma, quotes, gateway, new PrismaAuditRepository(prisma));
    const request = {
      serviceType: 'CAT_FEEDING' as const,
      petIds: [owner.pet.id],
      addressId: owner.address.id,
      startsAt: new Date('2026-09-01T08:00:00.000Z'),
      durationMinutes: 30,
      notes: '',
      idempotencyKey: 'pilot-order-0001',
    };

    const first = await orders.create(owner.actor, request);
    const replay = await orders.create(owner.actor, request);
    expect(first.paymentToken).toBeNull();
    expect(replay.paymentToken).toBeNull();
  });

  it('registers pilot routes and uses server time for check-in and report submission', async () => {
    const provider = await createProvider('服务者路由', '奥体东');
    const owner = await createOrderFixture({
      ownerName: '宠主路由', serviceZone: '奥体东', notes: '',
      status: 'PENDING_SERVICE', assignedProviderId: provider.profile.id,
    });
    const { actor: admin } = await createUser('ADMIN', '运营路由');
    const pendingFeeOrder = await createOrderFixture({
      ownerName: '费用路由宠主', serviceZone: '奥体东', notes: '',
    });
    const now = new Date('2026-09-01T07:50:00.000Z');
    const calls: Array<{ operation: string; at: Date; body: unknown }> = [];
    const fulfillment = {
      async checkIn(actor: ActorContext, orderId: string, at: Date, beforeState: unknown) {
        calls.push({ operation: `check-in:${actor.userId}:${orderId}`, at, body: beforeState });
        return { orderId };
      },
      async submitReport(actor: ActorContext, orderId: string, input: {
        checklist: unknown; afterState: unknown; notes: string; checkedOutAt: Date;
      }) {
        calls.push({ operation: `report:${actor.userId}:${orderId}`, at: input.checkedOutAt, body: input });
        return { orderId };
      },
    };
    const auth = new DatabaseHeaderAuth();
    const createInvite = async (actor: ActorContext, role: 'OWNER' | 'PROVIDER') => ({
      id: randomUUID(), role, code: `one-time-${actor.userId}`,
      expiresAt: new Date('2026-09-02T00:00:00.000Z'),
      createdAt: now,
    });
    const pilotBusiness = {
      fees: new ManualFeeService(prisma, new PrismaAuditRepository(prisma)),
      read: new PilotReadModel(prisma),
      fulfillment: fulfillment as never,
      now: () => now,
    };
    expect(() => createApp({
      auth,
      pets: {} as never,
      addresses: {} as never,
      pilotBusiness,
    })).toThrow('PILOT_SECURITY_CONFIGURATION_REQUIRED');

    let providerDisplayName: string | null = null;
    const pilotSessions = {
      redeem: async () => { throw new Error('INVITE_INVALID'); },
      authenticate: async (authorization: string | undefined) => {
        const token = authorization?.match(/^Bearer (.+)$/)?.[1];
        if (token === provider.user.id) {
          return {
            ...provider.actor,
            displayName: providerDisplayName,
            expiresAt: new Date('2026-09-02T00:00:00.000Z'),
          };
        }
        if (token === admin.userId) {
          return {
            ...admin,
            displayName: '运营路由',
            expiresAt: new Date('2026-09-02T00:00:00.000Z'),
          };
        }
        if (token === owner.owner.id) {
          return {
            ...owner.actor,
            displayName: '宠主路由',
            expiresAt: new Date('2026-09-02T00:00:00.000Z'),
          };
        }
        throw new Error('UNAUTHENTICATED');
      },
      setDisplayName: async (actor: ActorContext, displayName: string) => {
        providerDisplayName = displayName;
        return { id: actor.userId, role: actor.role, displayName };
      },
      revoke: async () => { throw new Error('UNAUTHENTICATED'); },
      createInvite,
    };
    const app = createApp({
      auth,
      pets: {} as never,
      addresses: {} as never,
      pilot: {
        config: {
          nodeEnv: 'development',
          databaseUrl: testUrl.toString(),
          pilot: {
            enabled: true,
            host: '127.0.0.1',
            port: 3000,
            authPepper: Buffer.alloc(32, 7),
            sessionDays: 7,
            inviteHours: 24,
            secureCookies: false,
          },
        },
        sessions: pilotSessions,
      },
      pilotBusiness,
    });

    const mismatchedAuth = await app.inject({
      method: 'GET',
      url: '/api/v1/pilot/dashboard',
      headers: { authorization: `Bearer ${pendingFeeOrder.owner.id}` },
    });
    expect(mismatchedAuth.statusCode).toBe(401);

    const nullNicknameRequests = [
      { method: 'POST' as const, url: '/api/v1/pilot/invites', payload: { role: 'OWNER' } },
      {
        method: 'POST' as const,
        url: `/api/v1/pilot/orders/${owner.order.id}/manual-fee-confirmation`,
        headers: { 'idempotency-key': 'onboarding-fee-0001' },
      },
      { method: 'GET' as const, url: '/api/v1/pilot/dashboard' },
      { method: 'GET' as const, url: '/api/v1/pilot/orders' },
      { method: 'GET' as const, url: `/api/v1/pilot/orders/${owner.order.id}` },
      { method: 'GET' as const, url: '/api/v1/pilot/providers/review-queue' },
      { method: 'GET' as const, url: '/api/v1/pilot/invites' },
      {
        method: 'POST' as const,
        url: `/api/v1/pilot/orders/${owner.order.id}/check-in`,
        payload: { beforeState: { petSafe: true } },
      },
      {
        method: 'POST' as const,
        url: `/api/v1/pilot/orders/${owner.order.id}/report`,
        payload: { checklist: {}, afterState: {}, notes: '' },
      },
    ];
    for (const request of nullNicknameRequests) {
      const response = await app.inject({
        ...request,
        headers: {
          authorization: `Bearer ${provider.user.id}`,
          ...request.headers,
        },
      });
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(403);
      expect(response.json()).toEqual({ code: 'ONBOARDING_REQUIRED' });
    }

    for (const request of [
      {
        method: 'POST' as const,
        url: '/api/v1/pilot/invites',
        payload: { role: 'ADMIN' },
      },
      {
        method: 'POST' as const,
        url: '/api/v1/pilot/orders/not-a-uuid/manual-fee-confirmation',
      },
      { method: 'GET' as const, url: '/api/v1/pilot/orders/not-a-uuid' },
      {
        method: 'POST' as const,
        url: '/api/v1/pilot/orders/not-a-uuid/check-in',
        payload: {},
      },
      {
        method: 'POST' as const,
        url: '/api/v1/pilot/orders/not-a-uuid/report',
        payload: {},
      },
    ]) {
      const response = await app.inject({
        ...request,
        headers: { authorization: `Bearer ${provider.user.id}` },
      });
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(403);
      expect(response.json()).toEqual({ code: 'ONBOARDING_REQUIRED' });
    }

    const nickname = await app.inject({
      method: 'PATCH',
      url: '/api/v1/pilot/me',
      headers: { authorization: `Bearer ${provider.user.id}` },
      payload: { displayName: '服务者路由' },
    });
    expect(nickname.statusCode).toBe(200);
    const afterNickname = await app.inject({
      method: 'GET',
      url: '/api/v1/pilot/orders',
      headers: { authorization: `Bearer ${provider.user.id}` },
    });
    expect(afterNickname.statusCode).toBe(200);
    calls.length = 0;

    const headers = { authorization: `Bearer ${provider.user.id}` };
    const checkIn = await app.inject({
      method: 'POST',
      url: `/api/v1/pilot/orders/${owner.order.id}/check-in`,
      headers,
      payload: { beforeState: { petSafe: true }, checkedInAt: '2035-01-01T00:00:00.000Z' },
    });
    const report = await app.inject({
      method: 'POST',
      url: `/api/v1/pilot/orders/${owner.order.id}/report`,
      headers,
      payload: {
        checklist: { petCountConfirmed: true },
        afterState: { petSafe: true },
        notes: '服务完成',
        checkedOutAt: '2035-01-01T00:00:00.000Z',
      },
    });
    const list = await app.inject({
      method: 'GET', url: '/api/v1/pilot/orders', headers,
    });
    const forbiddenQueue = await app.inject({
      method: 'GET',
      url: '/api/v1/pilot/providers/review-queue',
      headers: { authorization: `Bearer ${owner.owner.id}` },
    });
    const fee = await app.inject({
      method: 'POST',
      url: `/api/v1/pilot/orders/${owner.order.id}/manual-fee-confirmation`,
      headers: { authorization: `Bearer ${admin.userId}`, 'idempotency-key': 'manual-route-0001' },
    });
    const confirmedFee = await app.inject({
      method: 'POST',
      url: `/api/v1/pilot/orders/${pendingFeeOrder.order.id}/manual-fee-confirmation`,
      headers: { authorization: `Bearer ${admin.userId}`, 'idempotency-key': 'manual-route-0002' },
    });

    expect(checkIn.statusCode).toBe(201);
    expect(report.statusCode).toBe(200);
    expect(list.statusCode).toBe(200);
    expect(forbiddenQueue.statusCode).toBe(403);
    expect(fee.statusCode).toBe(409);
    expect(confirmedFee.statusCode).toBe(200);
    expect(confirmedFee.body).not.toContain('manual-route-0002');
    expect(confirmedFee.json()).not.toHaveProperty('manualConfirmationKey');
    expect(confirmedFee.json()).not.toHaveProperty('providerEventId');
    expect(calls.map((call) => call.at.toISOString())).toEqual([
      now.toISOString(), now.toISOString(),
    ]);

    for (const request of [
      {
        method: 'POST' as const,
        url: '/api/v1/pilot/orders/not-a-uuid/manual-fee-confirmation',
        headers: { authorization: `Bearer ${admin.userId}`, 'idempotency-key': 'malformed-uuid-0001' },
      },
      {
        method: 'GET' as const,
        url: '/api/v1/pilot/orders/not-a-uuid',
        headers,
      },
      {
        method: 'POST' as const,
        url: '/api/v1/pilot/orders/not-a-uuid/check-in',
        headers,
        payload: { beforeState: { petSafe: true } },
      },
      {
        method: 'POST' as const,
        url: '/api/v1/pilot/orders/not-a-uuid/report',
        headers,
        payload: { checklist: {}, afterState: {}, notes: '' },
      },
    ]) {
      const response = await app.inject(request);
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(400);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    await app.close();
  });
});
