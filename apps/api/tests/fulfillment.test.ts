import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { FakeObjectStorage } from '../src/adapters/fake-object-storage.js';
import { FieldCrypto } from '../src/adapters/field-crypto.js';
import { createApp } from '../src/app.js';
import { PrismaAuditRepository } from '../src/audit/audit-repository.js';
import type { ActorContext, AuthService } from '../src/auth/auth-service.js';
import { createDb } from '../src/db.js';
import { FulfillmentService } from '../src/fulfillment/fulfillment-service.js';
import { AddressService } from '../src/pets/address-service.js';
import { PetService } from '../src/pets/pet-service.js';

const prisma = createDb(process.env.DATABASE_URL);
const storage = new FakeObjectStorage();
const fulfillment = new FulfillmentService(prisma, new PrismaAuditRepository(prisma), storage, {
  maxUploadBytes: 20 * 1024 * 1024, readUrlTtlSeconds: 300,
});

class DatabaseHeaderAuth implements AuthService {
  public async authenticate(value: string | undefined): Promise<ActorContext> {
    if (!value?.startsWith('Bearer ')) throw new Error('UNAUTHENTICATED');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: value.slice(7) } });
    return { userId: user.id, role: user.role };
  }
}

const crypto = FieldCrypto.fromBase64(Buffer.alloc(32, 8).toString('base64'), 1);
const app = createApp({
  auth: new DatabaseHeaderAuth(), pets: new PetService(prisma, crypto),
  addresses: new AddressService(prisma, crypto, new PrismaAuditRepository(prisma)), fulfillment,
});

async function assignedOrder(serviceType: 'CAT_FEEDING' | 'DOG_WALKING') {
  const owner = await prisma.user.create({ data: { role: 'OWNER', phoneHash: randomUUID() } });
  const providerUser = await prisma.user.create({ data: { role: 'PROVIDER', phoneHash: randomUUID() } });
  const provider = await prisma.providerProfile.create({ data: {
    userId: providerUser.id, reviewStatus: 'APPROVED', serviceTypes: [serviceType],
    serviceZone: '奥体东', latitude: 32.01, longitude: 118.73, radiusKm: 5,
  }});
  const address = await prisma.serviceAddress.create({ data: {
    ownerId: owner.id, city: '南京市', district: '建邺区', serviceZone: '奥体东',
    latitude: 32.01, longitude: 118.73, detailCiphertext: new Uint8Array([1]),
    detailNonce: new Uint8Array([1]), detailAuthTag: new Uint8Array([1]), encryptionKeyVersion: 1,
  }});
  const startsAt = new Date(Date.now() + 60_000);
  const order = await prisma.order.create({ data: {
    ownerId: owner.id, addressId: address.id, assignedProviderId: provider.id,
    idempotencyKey: randomUUID(), serviceType, status: 'PENDING_SERVICE', startsAt,
    durationMinutes: 30, quoteSnapshot: { totalFen: 3900 }, totalFen: 3900,
  }});
  return {
    order, owner: { userId: owner.id, role: 'OWNER' } as ActorContext,
    provider: { userId: providerUser.id, role: 'PROVIDER' } as ActorContext,
  };
}

async function attachPhoto(actor: ActorContext, orderId: string, capturedAt: Date) {
  const upload = await fulfillment.issueUpload(actor, orderId, {
    mimeType: 'image/jpeg', sizeBytes: 1024, sha256: 'a'.repeat(64),
  });
  expect(storage.issuedQuotaScope(upload.objectKey)).toEqual({
    actorId: actor.userId,
    orderId,
  });
  storage.completeUpload(upload.objectKey);
  return fulfillment.attachEvidence(actor, orderId, {
    objectKey: upload.objectKey, mimeType: 'image/jpeg', sizeBytes: 1024,
    sha256: 'a'.repeat(64), capturedAt,
  });
}

describe('fulfillment evidence workflow', () => {
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it('exposes authenticated provider check-in over HTTP', async () => {
    const fixture = await assignedOrder('CAT_FEEDING');
    const response = await app.inject({
      method: 'POST', url: `/v1/orders/${fixture.order.id}/check-in`,
      headers: { authorization: `Bearer ${fixture.provider.userId}` },
      payload: { checkedInAt: fixture.order.startsAt.toISOString(), beforeState: { petSafe: true } },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: expect.any(String), orderId: fixture.order.id,
      checkedInAt: fixture.order.startsAt.toISOString(),
    });

    const issued = await app.inject({
      method: 'POST', url: `/v1/orders/${fixture.order.id}/evidence/uploads`,
      headers: { authorization: `Bearer ${fixture.provider.userId}` },
      payload: { mimeType: 'image/jpeg', sizeBytes: 1024, sha256: 'a'.repeat(64) },
    });
    const descriptor = issued.json<{ objectKey: string }>();
    storage.completeUpload(descriptor.objectKey);
    const attached = await app.inject({
      method: 'POST', url: `/v1/orders/${fixture.order.id}/evidence`,
      headers: { authorization: `Bearer ${fixture.provider.userId}` },
      payload: {
        objectKey: descriptor.objectKey, mimeType: 'image/jpeg', sizeBytes: 1024,
        sha256: 'a'.repeat(64), capturedAt: fixture.order.startsAt.toISOString(),
      },
    });
    expect(attached.statusCode).toBe(201);
    expect(attached.json()).toEqual({ id: expect.any(String) });

    const report = await app.inject({
      method: 'POST', url: `/v1/orders/${fixture.order.id}/report`,
      headers: { authorization: `Bearer ${fixture.provider.userId}` },
      payload: {
        checklist: {
          petCountConfirmed: true, foodRefilled: true,
          waterRefilled: true, litterCleaned: true,
        },
        afterState: { petSafe: true }, notes: '',
        checkedOutAt: new Date(fixture.order.startsAt.getTime() + 30 * 60_000).toISOString(),
      },
    });
    expect(report.statusCode).toBe(200);
    expect(report.json()).toEqual({
      id: expect.any(String), orderId: fixture.order.id, submittedAt: expect.any(String),
    });
  });

  it.each([
    ['CAT_FEEDING', { petCountConfirmed: true, foodRefilled: true, waterRefilled: true, litterCleaned: true }],
    ['DOG_WALKING', { leashSecured: true, walkDurationMinutes: 30 }],
  ] as const)('requires a complete %s checklist and evidence', async (serviceType, checklist) => {
    const fixture = await assignedOrder(serviceType);
    const checkedInAt = fixture.order.startsAt;
    await fulfillment.checkIn(fixture.provider, fixture.order.id, checkedInAt, { petSafe: true });
    await expect(fulfillment.submitReport(fixture.provider, fixture.order.id, {
      checklist, afterState: { petSafe: true }, notes: '服务正常',
      checkedOutAt: new Date(checkedInAt.getTime() + 30 * 60_000),
    })).rejects.toThrow('EVIDENCE_REQUIRED');
    await attachPhoto(fixture.provider, fixture.order.id, checkedInAt);
    const report = await fulfillment.submitReport(fixture.provider, fixture.order.id, {
      checklist, afterState: { petSafe: true }, notes: '服务正常',
      checkedOutAt: new Date(checkedInAt.getTime() + 30 * 60_000),
    });
    expect(report.submittedAt).toBeTruthy();
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } }))
      .toMatchObject({ status: 'PENDING_CONFIRMATION', version: 2 });
  });

  it('rejects incomplete service-specific checklists', async () => {
    const fixture = await assignedOrder('DOG_WALKING');
    await fulfillment.checkIn(fixture.provider, fixture.order.id, fixture.order.startsAt, { petSafe: true });
    await attachPhoto(fixture.provider, fixture.order.id, fixture.order.startsAt);
    await expect(fulfillment.submitReport(fixture.provider, fixture.order.id, {
      checklist: { leashSecured: false, walkDurationMinutes: 0 }, afterState: { petSafe: true },
      notes: '', checkedOutAt: new Date(fixture.order.startsAt.getTime() + 30 * 60_000),
    })).rejects.toThrow('CHECKLIST_INCOMPLETE');
  });

  it('replays an identical evidence attachment without duplicate rows or audit events', async () => {
    const fixture = await assignedOrder('CAT_FEEDING');
    await fulfillment.checkIn(
      fixture.provider, fixture.order.id, fixture.order.startsAt, { petSafe: true },
    );
    const upload = await fulfillment.issueUpload(fixture.provider, fixture.order.id, {
      mimeType: 'image/jpeg', sizeBytes: 1024, sha256: 'a'.repeat(64),
    });
    storage.completeUpload(upload.objectKey);
    const input = {
      objectKey: upload.objectKey, mimeType: 'image/jpeg', sizeBytes: 1024,
      sha256: 'a'.repeat(64), capturedAt: fixture.order.startsAt,
    };
    const first = await fulfillment.attachEvidence(fixture.provider, fixture.order.id, input);
    const replay = await fulfillment.attachEvidence(fixture.provider, fixture.order.id, input);

    expect(replay.id).toBe(first.id);
    expect(await prisma.mediaEvidence.count({ where: { objectKey: upload.objectKey } })).toBe(1);
    expect(await prisma.auditEvent.count({
      where: { action: 'SERVICE_EVIDENCE_ATTACHED', entityId: fixture.order.id },
    })).toBe(1);
  });

  it('enforces upload and evidence read authorization and media limits', async () => {
    const fixture = await assignedOrder('CAT_FEEDING');
    const stranger = await prisma.user.create({ data: { role: 'PROVIDER', phoneHash: randomUUID() } });
    const strangerActor = { userId: stranger.id, role: 'PROVIDER' } as ActorContext;
    await expect(fulfillment.issueUpload(strangerActor, fixture.order.id, {
      mimeType: 'image/jpeg', sizeBytes: 100, sha256: 'b'.repeat(64),
    })).rejects.toThrow('FORBIDDEN');
    await expect(fulfillment.issueUpload(fixture.provider, fixture.order.id, {
      mimeType: 'application/x-msdownload', sizeBytes: 100, sha256: 'b'.repeat(64),
    })).rejects.toThrow('MEDIA_TYPE_NOT_ALLOWED');
    await expect(fulfillment.issueUpload(fixture.provider, fixture.order.id, {
      mimeType: 'video/mp4', sizeBytes: 20 * 1024 * 1024 + 1, sha256: 'b'.repeat(64),
    })).rejects.toThrow('MEDIA_TOO_LARGE');

    await fulfillment.checkIn(fixture.provider, fixture.order.id, fixture.order.startsAt, { petSafe: true });
    const evidence = await attachPhoto(fixture.provider, fixture.order.id, fixture.order.startsAt);
    await expect(fulfillment.getEvidenceReadUrl(strangerActor, evidence.id)).rejects.toThrow('FORBIDDEN');
    expect((await fulfillment.getEvidenceReadUrl(fixture.owner, evidence.id)).url).toContain('read-token');
    expect((await fulfillment.getEvidenceReadUrl(fixture.provider, evidence.id)).expiresInSeconds).toBe(300);
    const support = await prisma.user.create({ data: { role: 'SUPPORT', phoneHash: randomUUID() } });
    expect((await fulfillment.getEvidenceReadUrl({ userId: support.id, role: 'SUPPORT' }, evidence.id)).url)
      .toContain('read-token');
  });
});
