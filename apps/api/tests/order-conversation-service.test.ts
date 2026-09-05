import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FieldCrypto } from '../src/adapters/field-crypto.js';
import { PrismaAuditRepository } from '../src/audit/audit-repository.js';
import type { ActorContext } from '../src/auth/auth-service.js';
import { OrderConversationService, orderMessageAssociatedData } from '../src/conversations/order-conversation-service.js';

const execFileAsync = promisify(execFile);
const databaseName = `petcare_conversations_${randomUUID().replaceAll('-', '')}`;
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
const crypto = FieldCrypto.fromBase64(Buffer.alloc(32, 29).toString('base64'), 1);

async function createOrder(ownerId: string) {
  const address = await prisma.serviceAddress.create({ data: {
    ownerId, city: '南京市', district: '建邺区', serviceZone: '建邺区', latitude: 32.01, longitude: 118.73,
    detailCiphertext: Buffer.from('address-ciphertext'), detailNonce: Buffer.alloc(12),
    detailAuthTag: Buffer.alloc(16), encryptionKeyVersion: 1,
  } });
  return prisma.order.create({ data: {
    ownerId, addressId: address.id, idempotencyKey: randomUUID(), serviceType: 'CAT_FEEDING',
    status: 'PENDING_DISPATCH', startsAt: new Date('2030-01-01T00:00:00.000Z'), durationMinutes: 30,
    quoteSnapshot: { totalFen: 3900 }, totalFen: 3900,
  } });
}

async function createUser(role: 'OWNER' | 'PROVIDER' | 'ADMIN' | 'SUPPORT') {
  return prisma.user.create({ data: { role, phoneHash: randomUUID() } });
}

function actor(userId: string, role: ActorContext['role']): ActorContext {
  return { userId, role };
}

describe('OrderConversationService', () => {
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

  it('lets an owner send and list only messages for their own order', async () => {
    const owner = await createUser('OWNER');
    const order = await createOrder(owner.id);
    const service = new OrderConversationService(prisma, crypto, new PrismaAuditRepository(prisma));

    const sent = await service.send(actor(owner.id, 'OWNER'), order.id, '  请问几点上门？  ');
    const listed = await service.list(actor(owner.id, 'OWNER'), order.id);

    expect(sent).toMatchObject({ orderId: order.id, authorRole: 'OWNER', body: '请问几点上门？' });
    expect(listed).toEqual({ items: [sent] });
  });

  it('lets ADMIN read and send owner conversation messages', async () => {
    const owner = await createUser('OWNER');
    const adminUser = await createUser('ADMIN');
    const order = await createOrder(owner.id);
    const service = new OrderConversationService(prisma, crypto, new PrismaAuditRepository(prisma));
    await service.send(actor(owner.id, 'OWNER'), order.id, '需要协助');

    const reply = await service.send(actor(adminUser.id, 'ADMIN'), order.id, '已安排客服处理');

    expect(await service.list(actor(adminUser.id, 'ADMIN'), order.id)).toEqual({
      items: [expect.objectContaining({ authorRole: 'OWNER', body: '需要协助' }), reply],
    });
  });

  it('denies another owner and every provider without decrypting messages', async () => {
    const owner = await createUser('OWNER');
    const otherOwner = await createUser('OWNER');
    const provider = await createUser('PROVIDER');
    const order = await createOrder(owner.id);
    const service = new OrderConversationService(prisma, crypto, new PrismaAuditRepository(prisma));
    await service.send(actor(owner.id, 'OWNER'), order.id, '隐私正文');

    await expect(service.list(actor(otherOwner.id, 'OWNER'), order.id)).rejects.toThrow('FORBIDDEN');
    await expect(service.send(actor(otherOwner.id, 'OWNER'), order.id, '伪造')).rejects.toThrow('FORBIDDEN');
    await expect(service.list(actor(provider.id, 'PROVIDER'), order.id)).rejects.toThrow('FORBIDDEN');
    await expect(service.send(actor(provider.id, 'PROVIDER'), order.id, '伪造')).rejects.toThrow('FORBIDDEN');
  });

  it('rejects empty, oversized, or invalid-role messages before persistence', async () => {
    const owner = await createUser('OWNER');
    const support = await createUser('SUPPORT');
    const order = await createOrder(owner.id);
    const service = new OrderConversationService(prisma, crypto, new PrismaAuditRepository(prisma));

    for (const body of ['', '   ', 'x'.repeat(501)]) {
      await expect(service.send(actor(owner.id, 'OWNER'), order.id, body)).rejects.toThrow('VALIDATION_ERROR');
    }
    await expect(service.send(actor(support.id, 'SUPPORT'), order.id, '平台伪造')).rejects.toThrow('FORBIDDEN');
    await expect(service.send(actor(owner.id, 'OWNER'), order.id, '你'.repeat(500)))
      .resolves.toMatchObject({ body: '你'.repeat(500) });
    expect(await prisma.orderMessage.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('stores separate authenticated-encryption fields and emits metadata-only audits', async () => {
    const owner = await createUser('OWNER');
    const order = await createOrder(owner.id);
    const service = new OrderConversationService(prisma, crypto, new PrismaAuditRepository(prisma));
    const body = '请勿把这段私密消息写入审计或数据库明文';

    const sent = await service.send(actor(owner.id, 'OWNER'), order.id, body);
    const stored = await prisma.orderMessage.findUniqueOrThrow({ where: { id: sent.id } });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: sent.id, action: 'ORDER_MESSAGE_SENT' } });
    const serialized = JSON.stringify({ stored, audit });

    expect(stored).toMatchObject({ orderId: order.id, authorUserId: owner.id, authorRole: 'OWNER', encryptionKeyVersion: 1, encryptionContextVersion: 1 });
    expect(Buffer.from(stored.bodyCiphertext).toString('utf8')).not.toContain(body);
    expect(stored.bodyNonce).toHaveLength(12);
    expect(stored.bodyAuthTag).toHaveLength(16);
    expect(audit.metadata).toEqual({ orderId: order.id, messageId: sent.id, bodyLength: [...body].length });
    expect(serialized).not.toContain(body);
  });

  it('orders pages by createdAt then id with a strict, stable cursor and a 50-message limit', async () => {
    const owner = await createUser('OWNER');
    const order = await createOrder(owner.id);
    const service = new OrderConversationService(prisma, crypto, new PrismaAuditRepository(prisma));
    const sharedTime = new Date('2030-01-01T00:00:00.000Z');
    const ids = Array.from({ length: 51 }, () => randomUUID()).sort();
    await prisma.orderMessage.createMany({ data: ids.map((id, index) => {
      const encrypted = crypto.encrypt(`message-${index}`, {
        associatedData: orderMessageAssociatedData(order.id, id, 'OWNER'),
      });
      return {
        id, orderId: order.id, authorUserId: owner.id, authorRole: 'OWNER',
        bodyCiphertext: Uint8Array.from(encrypted.ciphertext),
        bodyNonce: Uint8Array.from(encrypted.nonce),
        bodyAuthTag: Uint8Array.from(encrypted.authTag),
        encryptionKeyVersion: encrypted.keyVersion, encryptionContextVersion: 1, createdAt: sharedTime,
      };
    }) });

    const first = await service.list(actor(owner.id, 'OWNER'), order.id);
    const second = await service.list(actor(owner.id, 'OWNER'), order.id, first.nextCursor);

    expect(first.items).toHaveLength(50);
    expect(first.items.map((message) => message.id)).toEqual(ids.slice(0, 50));
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(second).toEqual({ items: [expect.objectContaining({ id: ids[50], body: 'message-50' })] });
    await expect(service.list(actor(owner.id, 'OWNER'), order.id, 'not-a-cursor')).rejects.toThrow('VALIDATION_ERROR');
    const cursor = Buffer.from(JSON.stringify({ createdAt: sharedTime.toISOString(), id: ids[0], extra: true })).toString('base64url');
    await expect(service.list(actor(owner.id, 'OWNER'), order.id, cursor)).rejects.toThrow('VALIDATION_ERROR');
    for (const invalidCursor of [
      Buffer.from(`{\"id\":\"${ids[0]}\",\"createdAt\":\"${sharedTime.toISOString()}\"}`).toString('base64url'),
      Buffer.from(`{ \"createdAt\": \"${sharedTime.toISOString()}\", \"id\": \"${ids[0]}\" }`).toString('base64url'),
      Buffer.from(`{\"createdAt\":\"${sharedTime.toISOString()}\",\"id\":\"${ids[0]}\",\"id\":\"${ids[0]}\"}`).toString('base64url'),
    ]) {
      await expect(service.list(actor(owner.id, 'OWNER'), order.id, invalidCursor)).rejects.toThrow('VALIDATION_ERROR');
    }
  });

  it('binds each message ciphertext to its order, row identity, and author role', async () => {
    const owner = await createUser('OWNER');
    const firstOrder = await createOrder(owner.id);
    const secondOrder = await createOrder(owner.id);
    const service = new OrderConversationService(prisma, crypto, new PrismaAuditRepository(prisma));
    const first = await service.send(actor(owner.id, 'OWNER'), firstOrder.id, 'first secret');
    const second = await service.send(actor(owner.id, 'OWNER'), firstOrder.id, 'second secret');
    const crossOrder = await service.send(actor(owner.id, 'OWNER'), secondOrder.id, 'cross-order secret');
    const firstStored = await prisma.orderMessage.findUniqueOrThrow({ where: { id: first.id } });
    const secondStored = await prisma.orderMessage.findUniqueOrThrow({ where: { id: second.id } });
    const crossOrderStored = await prisma.orderMessage.findUniqueOrThrow({ where: { id: crossOrder.id } });

    await prisma.orderMessage.update({ where: { id: first.id }, data: {
      bodyCiphertext: secondStored.bodyCiphertext, bodyNonce: secondStored.bodyNonce,
      bodyAuthTag: secondStored.bodyAuthTag, encryptionKeyVersion: secondStored.encryptionKeyVersion,
    } });
    await expect(service.list(actor(owner.id, 'OWNER'), firstOrder.id)).rejects.toThrow('MESSAGE_DECRYPTION_FAILED');
    await prisma.orderMessage.update({ where: { id: first.id }, data: {
      bodyCiphertext: crossOrderStored.bodyCiphertext, bodyNonce: crossOrderStored.bodyNonce,
      bodyAuthTag: crossOrderStored.bodyAuthTag, encryptionKeyVersion: crossOrderStored.encryptionKeyVersion,
    } });
    await expect(service.list(actor(owner.id, 'OWNER'), firstOrder.id)).rejects.toThrow('MESSAGE_DECRYPTION_FAILED');
    await prisma.orderMessage.update({ where: { id: first.id }, data: {
      bodyCiphertext: firstStored.bodyCiphertext, bodyNonce: firstStored.bodyNonce,
      bodyAuthTag: firstStored.bodyAuthTag, encryptionKeyVersion: firstStored.encryptionKeyVersion,
      authorRole: 'ADMIN',
    } });
    await expect(service.list(actor(owner.id, 'OWNER'), firstOrder.id)).rejects.toThrow('MESSAGE_DECRYPTION_FAILED');
    await prisma.orderMessage.update({ where: { id: first.id }, data: { encryptionKeyVersion: 99, authorRole: 'OWNER' } });
    await expect(service.list(actor(owner.id, 'OWNER'), firstOrder.id)).rejects.toThrow('MESSAGE_DECRYPTION_FAILED');
  });

  it('reads explicitly marked legacy no-AAD rows without weakening AAD-bound messages', async () => {
    const owner = await createUser('OWNER');
    const order = await createOrder(owner.id);
    const service = new OrderConversationService(prisma, crypto, new PrismaAuditRepository(prisma));
    const id = randomUUID();
    const encrypted = crypto.encrypt('pre-hardening legacy message');
    await prisma.orderMessage.create({ data: {
      id, orderId: order.id, authorUserId: owner.id, authorRole: 'OWNER',
      bodyCiphertext: Uint8Array.from(encrypted.ciphertext), bodyNonce: Uint8Array.from(encrypted.nonce),
      bodyAuthTag: Uint8Array.from(encrypted.authTag),
      encryptionKeyVersion: encrypted.keyVersion, encryptionContextVersion: null,
    } });

    expect(await service.list(actor(owner.id, 'OWNER'), order.id)).toEqual({
      items: [expect.objectContaining({ id, body: 'pre-hardening legacy message' })],
    });
    const current = await service.send(actor(owner.id, 'OWNER'), order.id, 'bound current message');
    const currentRow = await prisma.orderMessage.findUniqueOrThrow({ where: { id: current.id } });
    await prisma.orderMessage.update({ where: { id: current.id }, data: {
      bodyCiphertext: Uint8Array.from(encrypted.ciphertext), bodyNonce: Uint8Array.from(encrypted.nonce),
      bodyAuthTag: Uint8Array.from(encrypted.authTag),
    } });
    await expect(service.list(actor(owner.id, 'OWNER'), order.id)).rejects.toThrow('MESSAGE_DECRYPTION_FAILED');
    await prisma.orderMessage.update({ where: { id: current.id }, data: {
      bodyCiphertext: currentRow.bodyCiphertext, bodyNonce: currentRow.bodyNonce, bodyAuthTag: currentRow.bodyAuthTag,
    } });
  });

  it('reads v1 messages after switching the active key to v2 and rejects unknown row versions', async () => {
    const owner = await createUser('OWNER');
    const order = await createOrder(owner.id);
    const v1 = Buffer.alloc(32, 29).toString('base64');
    const v2 = Buffer.alloc(32, 30).toString('base64');
    const legacy = new OrderConversationService(prisma, FieldCrypto.fromBase64(v1, 1), new PrismaAuditRepository(prisma));
    const v1Message = await legacy.send(actor(owner.id, 'OWNER'), order.id, 'v1 message');
    const rotated = new OrderConversationService(
      prisma, FieldCrypto.fromKeyring([[1, v1], [2, v2]], 2), new PrismaAuditRepository(prisma),
    );

    expect(await rotated.list(actor(owner.id, 'OWNER'), order.id)).toEqual({ items: [v1Message] });
    await expect(rotated.send(actor(owner.id, 'OWNER'), order.id, 'v2 message'))
      .resolves.toMatchObject({ body: 'v2 message' });
    const v2Row = await prisma.orderMessage.findFirstOrThrow({ where: { orderId: order.id, encryptionKeyVersion: 2 } });
    expect(v2Row.encryptionKeyVersion).toBe(2);
    await prisma.orderMessage.update({ where: { id: v1Message.id }, data: { encryptionKeyVersion: 99 } });
    await expect(rotated.list(actor(owner.id, 'OWNER'), order.id)).rejects.toThrow('MESSAGE_DECRYPTION_FAILED');
  });

  it('fails closed without returning plaintext if the stored authentication tag is tampered', async () => {
    const owner = await createUser('OWNER');
    const order = await createOrder(owner.id);
    const service = new OrderConversationService(prisma, crypto, new PrismaAuditRepository(prisma));
    const body = 'tamper secret';
    const sent = await service.send(actor(owner.id, 'OWNER'), order.id, body);
    await prisma.orderMessage.update({ where: { id: sent.id }, data: { bodyAuthTag: Buffer.alloc(16, 255) } });

    await expect(service.list(actor(owner.id, 'OWNER'), order.id)).rejects.toThrow('MESSAGE_DECRYPTION_FAILED');
  });
});
