import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { FieldCrypto } from '../adapters/field-crypto.js';
import type { AuditRepository } from '../audit/audit-repository.js';
import type { ActorContext } from '../auth/auth-service.js';

const PAGE_SIZE = 50;
const MAX_BODY_CHARACTERS = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OrderMessageDto = {
  id: string;
  orderId: string;
  authorRole: 'OWNER' | 'ADMIN';
  body: string;
  createdAt: string;
};

export function orderMessageAssociatedData(
  orderId: string,
  messageId: string,
  authorRole: 'OWNER' | 'ADMIN',
): Buffer {
  return Buffer.from(JSON.stringify(['petcare.order-message', 1, orderId, messageId, authorRole]), 'utf8');
}

type MessageCursor = { createdAt: Date; id: string };

export class OrderConversationService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly fieldCrypto: FieldCrypto,
    private readonly audit: AuditRepository,
  ) {}

  public async list(
    actor: ActorContext,
    orderId: string,
    cursor?: string,
  ): Promise<{ items: OrderMessageDto[]; nextCursor?: string }> {
    await this.authorize(actor, orderId);
    const after = cursor === undefined ? undefined : decodeCursor(cursor);
    const messages = await this.prisma.orderMessage.findMany({
      where: {
        orderId,
        ...(after ? {
          OR: [
            { createdAt: { gt: after.createdAt } },
            { createdAt: after.createdAt, id: { gt: after.id } },
          ],
        } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: PAGE_SIZE + 1,
      select: {
        id: true, orderId: true, authorRole: true, bodyCiphertext: true, bodyNonce: true,
        bodyAuthTag: true, encryptionKeyVersion: true, createdAt: true,
      },
    });
    const hasNextPage = messages.length > PAGE_SIZE;
    const page = hasNextPage ? messages.slice(0, PAGE_SIZE) : messages;
    const items = page.map((message) => this.toDto(message));
    const last = page.at(-1);
    return {
      items,
      ...(hasNextPage && last ? { nextCursor: encodeCursor(last.createdAt, last.id) } : {}),
    };
  }

  public async send(actor: ActorContext, orderId: string, body: string): Promise<OrderMessageDto> {
    await this.authorize(actor, orderId);
    if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') throw new Error('FORBIDDEN');
    const normalizedBody = body.trim();
    if (!normalizedBody || [...normalizedBody].length > MAX_BODY_CHARACTERS) {
      throw new Error('VALIDATION_ERROR');
    }
    const id = randomUUID();
    const encrypted = this.fieldCrypto.encrypt(normalizedBody, {
      associatedData: orderMessageAssociatedData(orderId, id, actor.role),
    });
    const message = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.orderMessage.create({ data: {
        id,
        orderId,
        authorUserId: actor.userId,
        authorRole: actor.role,
        bodyCiphertext: new Uint8Array(encrypted.ciphertext),
        bodyNonce: new Uint8Array(encrypted.nonce),
        bodyAuthTag: new Uint8Array(encrypted.authTag),
        encryptionKeyVersion: encrypted.keyVersion,
      } });
      await this.audit.append({
        actorId: actor.userId,
        actorRole: actor.role,
        action: 'ORDER_MESSAGE_SENT',
        entityType: 'OrderMessage',
        entityId: created.id,
        metadata: { orderId, messageId: created.id, bodyLength: [...normalizedBody].length },
      }, transaction);
      return created;
    });
    return this.toDto(message);
  }

  private async authorize(actor: ActorContext, orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId }, select: { ownerId: true },
    });
    if (!order) throw new Error('ORDER_NOT_FOUND');
    if (actor.role === 'ADMIN') return;
    if (actor.role === 'OWNER' && actor.userId === order.ownerId) return;
    throw new Error('FORBIDDEN');
  }

  private toDto(message: {
    id: string;
    orderId: string;
    authorRole: string;
    bodyCiphertext: Uint8Array<ArrayBufferLike>;
    bodyNonce: Uint8Array<ArrayBufferLike>;
    bodyAuthTag: Uint8Array<ArrayBufferLike>;
    encryptionKeyVersion: number;
    createdAt: Date;
  }): OrderMessageDto {
    if (message.authorRole !== 'OWNER' && message.authorRole !== 'ADMIN') {
      throw new Error('MESSAGE_DECRYPTION_FAILED');
    }
    try {
      return {
        id: message.id,
        orderId: message.orderId,
        authorRole: message.authorRole,
        body: this.fieldCrypto.decrypt({
          ciphertext: Buffer.from(message.bodyCiphertext),
          nonce: Buffer.from(message.bodyNonce),
          authTag: Buffer.from(message.bodyAuthTag),
          keyVersion: message.encryptionKeyVersion,
        }, { associatedData: orderMessageAssociatedData(message.orderId, message.id, message.authorRole) }),
        createdAt: message.createdAt.toISOString(),
      };
    } catch {
      throw new Error('MESSAGE_DECRYPTION_FAILED');
    }
  }
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString('base64url');
}

function decodeCursor(value: string): MessageCursor {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('VALIDATION_ERROR');
  let parsed: unknown;
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) throw new Error('non-canonical cursor');
    parsed = JSON.parse(decoded.toString('utf8'));
  } catch {
    throw new Error('VALIDATION_ERROR');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('VALIDATION_ERROR');
  const object = parsed as Record<string, unknown>;
  if (Object.keys(object).length !== 2 || typeof object.createdAt !== 'string' || typeof object.id !== 'string') {
    throw new Error('VALIDATION_ERROR');
  }
  const createdAt = new Date(object.createdAt);
  if (!UUID_PATTERN.test(object.id) || Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== object.createdAt) {
    throw new Error('VALIDATION_ERROR');
  }
  if (decodedJson(value) !== JSON.stringify({ createdAt: object.createdAt, id: object.id })) {
    throw new Error('VALIDATION_ERROR');
  }
  return { createdAt, id: object.id };
}

function decodedJson(value: string): string {
  try { return Buffer.from(value, 'base64url').toString('utf8'); }
  catch { throw new Error('VALIDATION_ERROR'); }
}
