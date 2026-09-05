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
import { OrderConversationService } from '../src/conversations/order-conversation-service.js';

const execFileAsync = promisify(execFile);
const databaseName = `petcare_conversation_routes_${randomUUID().replaceAll('-', '')}`;
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
const pilot = {
  config: {
    nodeEnv: 'development' as const,
    databaseUrl: testUrl.toString(),
    pilot: {
      enabled: true as const, host: '127.0.0.1', port: 3000, authPepper: Buffer.alloc(32, 1),
      sessionDays: 7, inviteHours: 24, secureCookies: false,
    },
  },
  sessions: {} as never,
};

class HeaderAuth implements AuthService {
  public async authenticate(value: string | undefined): Promise<ActorContext> {
    const match = /^Bearer ([0-9a-f-]+):(OWNER|PROVIDER|ADMIN)$/.exec(value ?? '');
    if (!match) throw new Error('UNAUTHENTICATED');
    return { userId: match[1]!, role: match[2]! as ActorContext['role'] };
  }
}

async function fixture() {
  const owner = await prisma.user.create({ data: { role: 'OWNER', phoneHash: randomUUID() } });
  const provider = await prisma.user.create({ data: { role: 'PROVIDER', phoneHash: randomUUID() } });
  const adminUser = await prisma.user.create({ data: { role: 'ADMIN', phoneHash: randomUUID() } });
  const address = await prisma.serviceAddress.create({ data: {
    ownerId: owner.id, city: '南京市', district: '建邺区', serviceZone: '建邺区', latitude: 32.01, longitude: 118.73,
    detailCiphertext: Buffer.from('address-ciphertext'), detailNonce: Buffer.alloc(12),
    detailAuthTag: Buffer.alloc(16), encryptionKeyVersion: 1,
  } });
  const order = await prisma.order.create({ data: {
    ownerId: owner.id, addressId: address.id, idempotencyKey: randomUUID(), serviceType: 'CAT_FEEDING',
    status: 'PENDING_DISPATCH', startsAt: new Date('2030-01-01T00:00:00.000Z'), durationMinutes: 30,
    quoteSnapshot: { totalFen: 3900 }, totalFen: 3900,
  } });
  return { owner, provider, adminUser, order };
}

describe('order conversation routes', () => {
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

  it('only exposes the exact no-store owner/admin API DTOs', async () => {
    const data = await fixture();
    const crypto = FieldCrypto.fromBase64(Buffer.alloc(32, 30).toString('base64'), 1);
    const conversations = new OrderConversationService(prisma, crypto, new PrismaAuditRepository(prisma));
    const app = createApp({
      auth: new HeaderAuth(), pets: {} as never, addresses: {} as never,
      pilot,
      conversations: { auth: new HeaderAuth(), conversations },
    });
    try {
      const ownerAuth = { authorization: `Bearer ${data.owner.id}:OWNER` };
      const created = await app.inject({ method: 'POST', url: `/api/v1/pilot/orders/${data.order.id}/messages`,
        headers: ownerAuth, payload: { body: '  请帮忙确认时间  ' } });
      const listed = await app.inject({ method: 'GET', url: `/api/v1/pilot/orders/${data.order.id}/messages`, headers: ownerAuth });
      const adminReply = await app.inject({ method: 'POST', url: `/api/v1/pilot/orders/${data.order.id}/messages`,
        headers: { authorization: `Bearer ${data.adminUser.id}:ADMIN` }, payload: { body: '已确认' } });

      expect(created.statusCode).toBe(201);
      expect(created.headers['cache-control']).toBe('no-store');
      expect(created.json()).toEqual(expect.objectContaining({ orderId: data.order.id, authorRole: 'OWNER', body: '请帮忙确认时间' }));
      expect(listed.statusCode).toBe(200);
      expect(listed.headers['cache-control']).toBe('no-store');
      expect(listed.json()).toEqual({ items: [created.json()] });
      expect(adminReply.statusCode).toBe(201);
      expect(adminReply.json()).toEqual(expect.objectContaining({ authorRole: 'ADMIN', body: '已确认' }));
      expect(JSON.stringify(listed.json())).not.toMatch(/ciphertext|nonce|authTag|authorUserId/i);
    } finally { await app.close(); }
  });

  it('returns safe 401, 403, 400, and 404 responses without leaking encrypted or plaintext messages', async () => {
    const data = await fixture();
    const crypto = FieldCrypto.fromBase64(Buffer.alloc(32, 31).toString('base64'), 1);
    const secret = 'provider must never see this';
    const conversations = new OrderConversationService(prisma, crypto, new PrismaAuditRepository(prisma));
    await conversations.send({ userId: data.owner.id, role: 'OWNER' }, data.order.id, secret);
    const app = createApp({
      auth: new HeaderAuth(), pets: {} as never, addresses: {} as never,
      pilot,
      conversations: { auth: new HeaderAuth(), conversations },
    });
    try {
      const url = `/api/v1/pilot/orders/${data.order.id}/messages`;
      const unauthenticated = await app.inject({ method: 'GET', url });
      const provider = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${data.provider.id}:PROVIDER` } });
      const malformedBody = await app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${data.owner.id}:OWNER` }, payload: { body: '', authorRole: 'ADMIN' } });
      const malformedOrder = await app.inject({ method: 'GET', url: '/api/v1/pilot/orders/not-a-uuid/messages', headers: { authorization: `Bearer ${data.owner.id}:OWNER` } });
      const missing = await app.inject({ method: 'GET', url: `/api/v1/pilot/orders/${randomUUID()}/messages`, headers: { authorization: `Bearer ${data.adminUser.id}:ADMIN` } });

      expect(unauthenticated.statusCode).toBe(401);
      expect(provider.statusCode).toBe(403);
      expect(malformedBody.statusCode).toBe(400);
      expect(malformedOrder.statusCode).toBe(400);
      expect(missing.statusCode).toBe(404);
      for (const response of [provider, malformedBody, malformedOrder, missing]) {
        expect(response.body).not.toContain(secret);
        expect(response.body).not.toMatch(/ciphertext|nonce|authTag/i);
      }
    } finally { await app.close(); }
  });
});
