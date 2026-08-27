import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalPilotObjectStorage } from '../src/adapters/local-pilot-object-storage.js';
import { createApp } from '../src/app.js';
import { registerLocalUploadRoutes } from '../src/pilot/local-upload-routes.js';

const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPEG_BYTES = Buffer.from('ffd8ffe0000e4a4649460001010000010001ffd9', 'hex');
const JPEG_DQT_BYTES = Buffer.from('ffd8ffdb00040000ffd9', 'hex');
const JPEG_FILL_TRAILING_BYTES = Buffer.from('ffd8ffffdb00040000ffd9001122', 'hex');
const WEBP_BYTES = Buffer.from('5249464608000000574542505650384c', 'hex');
const MP4_BYTES = Buffer.from('000000186674797069736f6d000000006d70343269736f6d', 'hex');
const QUICKTIME_BYTES = Buffer.from('0000001466747970717420200000000071742020', 'hex');
const EXTENDED_MP4_BYTES = Buffer.from(
  '000000016674797000000000000000206d703432000000006d7034324d534e56',
  'hex',
);
const MANIFEST_NAME = '.pilot-storage.manifest.json';
const MAX_UPLOAD_BYTES = 1024;
const SIGNING_SECRET = Buffer.alloc(32, 0x47);

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function tokenFrom(url: string): string {
  const token = new URL(url, 'http://pilot').searchParams.get('token');
  if (!token) throw new Error('test URL omitted token');
  return token;
}

function tamperToken(token: string, change: (payload: Record<string, unknown>) => void): string {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) throw new Error('test token malformed');
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>;
  change(payload);
  return `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`;
}

describe('LocalPilotObjectStorage', () => {
  let rootDir: string;
  let now: Date;
  let storage: LocalPilotObjectStorage;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), 'petcare-local-evidence-'));
    now = new Date('2026-08-27T12:00:00.000Z');
    storage = new LocalPilotObjectStorage({
      rootDir,
      signingSecret: SIGNING_SECRET,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      now: () => now,
    });
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  async function issue(objectKey = 'orders/11111111-1111-4111-8111-111111111111/evidence-1') {
    const orderId = objectKey.split('/')[1]!;
    return storage.issueUpload({
      objectKey,
      mimeType: 'image/png',
      sizeBytes: PNG_BYTES.length,
      sha256: sha256(PNG_BYTES),
      expiresInSeconds: 600,
      quotaScope: { actorId: 'actor-11111111', orderId },
    });
  }

  async function entries(): Promise<string[]> {
    return (await readdir(rootDir, { recursive: true })).map(String).sort();
  }

  it('atomically accepts a signed upload, verifies metadata, and permits a signed read', async () => {
    const issued = await issue();
    await storage.acceptUpload(tokenFrom(issued.uploadUrl), PNG_BYTES);

    expect(await storage.verifyUpload(issued.objectKey, {
      mimeType: 'image/png',
      sizeBytes: PNG_BYTES.length,
      sha256: sha256(PNG_BYTES),
    })).toBe(true);
    expect(await storage.verifyUpload(issued.objectKey, {
      mimeType: 'image/jpeg',
      sizeBytes: PNG_BYTES.length,
      sha256: sha256(PNG_BYTES),
    })).toBe(false);

    const readUrl = await storage.issueReadUrl(issued.objectKey, 300);
    const read = await storage.readObject(tokenFrom(readUrl));
    expect(read).toEqual({ bytes: PNG_BYTES, mimeType: 'image/png' });
    expect(issued.uploadUrl).not.toContain(rootDir);
    expect(readUrl).not.toContain(rootDir);
    expect(await entries()).toHaveLength(3);
    expect(await entries()).toEqual(expect.arrayContaining([
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.stringMatching(/^[a-f0-9]{64}\.json$/),
    ]));
  });

  it('rejects traversal before creating directories or files', async () => {
    await expect(issue('../private-address')).rejects.toThrow('FORBIDDEN');
    await expect(issue('orders/../../private-address')).rejects.toThrow('FORBIDDEN');
    await expect(issue('orders\\..\\private-address')).rejects.toThrow('FORBIDDEN');
    await expect(issue('C:\\private-address')).rejects.toThrow('FORBIDDEN');
    expect(await entries()).toEqual([]);
  });

  it('does not follow a symlinked object-key ancestor outside the configured root', async () => {
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'petcare-evidence-outside-'));
    try {
      await storage.initialize();
      await symlink(outsideDir, path.join(rootDir, 'orders'), 'junction');
      const issued = await issue();

      await storage.acceptUpload(tokenFrom(issued.uploadUrl), PNG_BYTES);
      expect(await storage.verifyUpload(issued.objectKey, {
        mimeType: 'image/png', sizeBytes: PNG_BYTES.length, sha256: sha256(PNG_BYTES),
      })).toBe(true);
      expect(await readdir(outsideDir)).toEqual([]);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('does not verify or sign objects planted behind a junction outside the root', async () => {
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'petcare-evidence-planted-'));
    const objectKey = 'orders/11111111-1111-4111-8111-111111111111/evidence-1';
    try {
      await storage.initialize();
      const plantedPath = path.join(outsideDir, ...objectKey.split('/').slice(1));
      await mkdir(path.dirname(plantedPath), { recursive: true });
      await writeFile(plantedPath, PNG_BYTES);
      await writeFile(`${plantedPath}.json`, JSON.stringify({
        mimeType: 'image/png', sizeBytes: PNG_BYTES.length, sha256: sha256(PNG_BYTES),
      }));
      await symlink(outsideDir, path.join(rootDir, 'orders'), 'junction');

      expect(await storage.verifyUpload(objectKey, {
        mimeType: 'image/png', sizeBytes: PNG_BYTES.length, sha256: sha256(PNG_BYTES),
      })).toBe(false);
      await expect(storage.issueReadUrl(objectKey, 300)).rejects.toThrow('FORBIDDEN');
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('does not read through a configured root that is itself a junction', async () => {
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'petcare-evidence-root-target-'));
    const junctionRoot = path.join(rootDir, 'junction-root');
    try {
      const outsideStorage = new LocalPilotObjectStorage({
        rootDir: outsideRoot,
        signingSecret: SIGNING_SECRET,
        maxUploadBytes: MAX_UPLOAD_BYTES,
        now: () => now,
      });
      const issued = await outsideStorage.issueUpload({
        objectKey: 'orders/11111111-1111-4111-8111-111111111111/evidence-root',
        mimeType: 'image/png', sizeBytes: PNG_BYTES.length, sha256: sha256(PNG_BYTES),
        expiresInSeconds: 600,
      });
      await outsideStorage.acceptUpload(tokenFrom(issued.uploadUrl), PNG_BYTES);
      await symlink(outsideRoot, junctionRoot, 'junction');
      const junctionStorage = new LocalPilotObjectStorage({
        rootDir: junctionRoot,
        signingSecret: SIGNING_SECRET,
        maxUploadBytes: MAX_UPLOAD_BYTES,
        now: () => now,
      });

      await expect(junctionStorage.verifyUpload(issued.objectKey, {
        mimeType: 'image/png', sizeBytes: PNG_BYTES.length, sha256: sha256(PNG_BYTES),
      })).rejects.toThrow('FORBIDDEN');
      await expect(junctionStorage.issueReadUrl(issued.objectKey, 300))
        .rejects.toThrow('FORBIDDEN');
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('rejects expired, oversized, wrong-digest, cross-object, and wrong-operation uploads without writes', async () => {
    const issued = await issue();
    const uploadToken = tokenFrom(issued.uploadUrl);

    now = new Date('2026-08-27T12:10:01.000Z');
    await expect(storage.acceptUpload(uploadToken, PNG_BYTES)).rejects.toThrow('FORBIDDEN');
    now = new Date('2026-08-27T12:00:00.000Z');

    await expect(storage.acceptUpload(uploadToken, Buffer.concat([PNG_BYTES, Buffer.from([0])])))
      .rejects.toThrow('UPLOAD_INVALID');
    await expect(storage.acceptUpload(uploadToken, Buffer.alloc(PNG_BYTES.length, 0xff)))
      .rejects.toThrow('UPLOAD_INVALID');

    const otherObjectToken = tamperToken(uploadToken, (payload) => {
      payload.objectKey = 'orders/22222222-2222-4222-8222-222222222222/evidence-1';
    });
    await expect(storage.acceptUpload(otherObjectToken, PNG_BYTES)).rejects.toThrow('FORBIDDEN');

    const forgedMimeToken = tamperToken(uploadToken, (payload) => {
      payload.mimeType = 'image/jpeg';
    });
    await expect(storage.acceptUpload(forgedMimeToken, PNG_BYTES)).rejects.toThrow('FORBIDDEN');

    const readToken = tamperToken(uploadToken, (payload) => {
      payload.operation = 'read';
    });
    await expect(storage.acceptUpload(readToken, PNG_BYTES)).rejects.toThrow('FORBIDDEN');
    expect(await entries()).toEqual([MANIFEST_NAME]);
  });

  it('enforces declared type, size, digest, expiry, and safe object-key limits at issuance', async () => {
    const valid = {
      objectKey: 'orders/11111111-1111-4111-8111-111111111111/evidence-1',
      mimeType: 'image/png',
      sizeBytes: PNG_BYTES.length,
      sha256: sha256(PNG_BYTES),
      expiresInSeconds: 600,
    };

    for (const input of [
      { ...valid, mimeType: 'text/html' },
      { ...valid, sizeBytes: 0 },
      { ...valid, sizeBytes: MAX_UPLOAD_BYTES + 1 },
      { ...valid, sha256: 'not-a-digest' },
      { ...valid, expiresInSeconds: 0 },
      { ...valid, expiresInSeconds: 24 * 60 * 60 + 1 },
      { ...valid, objectKey: `${valid.objectKey}.json` },
    ]) {
      await expect(storage.issueUpload(input)).rejects.toThrow('UPLOAD_INVALID');
    }
    expect(await entries()).toEqual([]);
  });

  it('normalizes an uppercase SHA-256 digest accepted by the fulfillment contract', async () => {
    const expected = {
      mimeType: 'image/png',
      sizeBytes: PNG_BYTES.length,
      sha256: sha256(PNG_BYTES).toUpperCase(),
    };
    const issued = await storage.issueUpload({
      objectKey: 'orders/11111111-1111-4111-8111-111111111111/evidence-uppercase',
      ...expected,
      expiresInSeconds: 600,
      quotaScope: {
        actorId: 'actor-11111111',
        orderId: '11111111-1111-4111-8111-111111111111',
      },
    });

    await storage.acceptUpload(tokenFrom(issued.uploadUrl), PNG_BYTES);
    expect(await storage.verifyUpload(issued.objectKey, expected)).toBe(true);
  });

  it('fails closed when metadata or stored content is altered', async () => {
    const issued = await issue();
    await storage.acceptUpload(tokenFrom(issued.uploadUrl), PNG_BYTES);
    const [objectFilename] = (await readdir(rootDir)).filter((entry) => !entry.endsWith('.json'));
    if (!objectFilename) throw new Error('test object file omitted');
    const objectPath = path.join(rootDir, objectFilename);
    const metadataPath = `${objectPath}.json`;
    const originalMetadata = await readFile(metadataPath);
    const staleReadUrl = await storage.issueReadUrl(issued.objectKey, 300);

    await writeFile(objectPath, Buffer.alloc(PNG_BYTES.length, 0xee));
    expect(await storage.verifyUpload(issued.objectKey, {
      mimeType: 'image/png', sizeBytes: PNG_BYTES.length, sha256: sha256(PNG_BYTES),
    })).toBe(false);
    await expect(storage.readObject(tokenFrom(staleReadUrl))).rejects.toThrow('FORBIDDEN');

    await writeFile(objectPath, PNG_BYTES);
    const metadata = JSON.parse(originalMetadata.toString('utf8')) as Record<string, unknown>;
    metadata.mimeType = 'image/jpeg';
    await writeFile(metadataPath, JSON.stringify(metadata));
    expect(await storage.verifyUpload(issued.objectKey, {
      mimeType: 'image/png', sizeBytes: PNG_BYTES.length, sha256: sha256(PNG_BYTES),
    })).toBe(false);
    await expect(storage.issueReadUrl(issued.objectKey, 300)).rejects.toThrow('FORBIDDEN');
  });

  it.each([
    ['image/png', PNG_BYTES],
    ['image/jpeg', JPEG_BYTES],
    ['image/jpeg', JPEG_FILL_TRAILING_BYTES],
    ['image/webp', WEBP_BYTES],
    ['video/mp4', MP4_BYTES],
    ['video/mp4', EXTENDED_MP4_BYTES],
    ['video/quicktime', QUICKTIME_BYTES],
  ] as const)('accepts bytes with a strict %s signature', async (mimeType, bytes) => {
    const objectKey = `orders/11111111-1111-4111-8111-111111111111/${mimeType.replace('/', '-')}`;
    const issued = await storage.issueUpload({
      objectKey,
      mimeType,
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
      expiresInSeconds: 600,
      quotaScope: {
        actorId: 'actor-11111111',
        orderId: '11111111-1111-4111-8111-111111111111',
      },
    });

    await storage.acceptUpload(tokenFrom(issued.uploadUrl), bytes);
    expect(await storage.verifyUpload(issued.objectKey, {
      mimeType, sizeBytes: bytes.length, sha256: sha256(bytes),
    })).toBe(true);
  });

  it('accepts a JPEG beginning with a legal non-APP marker', async () => {
    const issued = await storage.issueUpload({
      objectKey: 'orders/11111111-1111-4111-8111-111111111111/jpeg-dqt',
      mimeType: 'image/jpeg',
      sizeBytes: JPEG_DQT_BYTES.length,
      sha256: sha256(JPEG_DQT_BYTES),
      expiresInSeconds: 600,
      quotaScope: {
        actorId: 'actor-11111111',
        orderId: '11111111-1111-4111-8111-111111111111',
      },
    });

    await storage.acceptUpload(tokenFrom(issued.uploadUrl), JPEG_DQT_BYTES);
    expect(await storage.verifyUpload(issued.objectKey, {
      mimeType: 'image/jpeg',
      sizeBytes: JPEG_DQT_BYTES.length,
      sha256: sha256(JPEG_DQT_BYTES),
    })).toBe(true);
  });

  it.each([
    ['image/jpeg', PNG_BYTES],
    ['image/webp', PNG_BYTES],
    ['video/mp4', QUICKTIME_BYTES],
    ['video/quicktime', MP4_BYTES],
    ['image/png', Buffer.from('not a png')],
  ] as const)('rejects bytes that do not match declared %s without leaving files', async (mimeType, bytes) => {
    const objectKey = 'orders/11111111-1111-4111-8111-111111111111/evidence-mismatch';
    const issued = await storage.issueUpload({
      objectKey,
      mimeType,
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
      expiresInSeconds: 600,
      quotaScope: {
        actorId: 'actor-11111111',
        orderId: '11111111-1111-4111-8111-111111111111',
      },
    });

    await expect(storage.acceptUpload(tokenFrom(issued.uploadUrl), bytes))
      .rejects.toThrow('UPLOAD_INVALID');
    expect(await entries()).toEqual([MANIFEST_NAME]);
  });

  it('atomically bounds concurrent pending and stored objects per order and actor', async () => {
    const limited = new LocalPilotObjectStorage({
      rootDir,
      signingSecret: SIGNING_SECRET,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      now: () => now,
      quotas: {
        maxObjectsPerOrder: 1,
        maxObjectsPerActor: 2,
        maxTotalObjects: 3,
        maxBytesPerOrder: 100,
        maxBytesPerActor: 100,
        maxTotalBytes: 100,
      },
    });
    const input = (orderId: string, suffix: string) => ({
      objectKey: `orders/${orderId}/${suffix}`,
      mimeType: 'image/png',
      sizeBytes: PNG_BYTES.length,
      sha256: sha256(PNG_BYTES),
      expiresInSeconds: 600,
      quotaScope: { actorId: 'actor-a', orderId },
    });

    const sameOrder = await Promise.allSettled([
      limited.issueUpload(input('order-a', 'evidence-a')),
      limited.issueUpload(input('order-a', 'evidence-b')),
    ]);
    expect(sameOrder.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(sameOrder.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((sameOrder.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason)
      .toMatchObject({ message: 'EVIDENCE_QUOTA_EXCEEDED' });

    await limited.issueUpload(input('order-b', 'evidence-c'));
    await expect(limited.issueUpload({
      ...input('order-c', 'evidence-d'),
    })).rejects.toThrow('EVIDENCE_QUOTA_EXCEEDED');

    now = new Date('2026-08-27T12:10:01.000Z');
    await expect(limited.issueUpload(input('order-c', 'evidence-after-expiry'))).resolves.toBeDefined();
  });

  it('bounds pending and stored bytes per order and actor across adapter instances', async () => {
    const options = {
      rootDir,
      signingSecret: SIGNING_SECRET,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      now: () => now,
      quotas: {
        maxObjectsPerOrder: 10,
        maxObjectsPerActor: 10,
        maxTotalObjects: 20,
        maxBytesPerOrder: PNG_BYTES.length,
        maxBytesPerActor: PNG_BYTES.length * 2,
        maxTotalBytes: PNG_BYTES.length * 10,
      },
    };
    const first = new LocalPilotObjectStorage(options);
    const second = new LocalPilotObjectStorage(options);
    const request = (orderId: string, suffix: string) => ({
      objectKey: `orders/${orderId}/${suffix}`,
      mimeType: 'image/png', sizeBytes: PNG_BYTES.length, sha256: sha256(PNG_BYTES),
      expiresInSeconds: 600,
      quotaScope: { actorId: 'actor-bytes', orderId },
    });

    const sameOrder = await Promise.allSettled([
      first.issueUpload(request('order-a', 'a')),
      second.issueUpload(request('order-a', 'b')),
    ]);
    expect(sameOrder.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(sameOrder.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await expect(first.issueUpload(request('order-b', 'c'))).resolves.toBeDefined();
    await expect(second.issueUpload(request('order-c', 'd')))
      .rejects.toThrow('EVIDENCE_QUOTA_EXCEEDED');
  });

  it('rejects non-positive, fractional, unsafe, partial, extra, or inverted quota configuration', () => {
    const validQuotas = {
      maxObjectsPerOrder: 1,
      maxObjectsPerActor: 2,
      maxTotalObjects: 3,
      maxBytesPerOrder: 50,
      maxBytesPerActor: 75,
      maxTotalBytes: 100,
    };
    for (const quotas of [
      { ...validQuotas, maxObjectsPerOrder: 0 },
      { ...validQuotas, maxObjectsPerActor: 1.5 },
      { ...validQuotas, maxTotalObjects: Number.MAX_SAFE_INTEGER + 1 },
      { ...validQuotas, maxBytesPerOrder: 0 },
      { ...validQuotas, maxTotalBytes: -1 },
      { ...validQuotas, maxObjectsPerOrder: 3, maxObjectsPerActor: 2 },
      { ...validQuotas, maxBytesPerOrder: 76, maxBytesPerActor: 75 },
      { maxObjectsPerOrder: 1, maxObjectsPerActor: 2, maxTotalObjects: 3,
        maxBytesPerOrder: 50, maxTotalBytes: 100 } as never,
      { ...validQuotas, unexpected: 1 },
    ]) {
      expect(() => new LocalPilotObjectStorage({
        rootDir,
        signingSecret: SIGNING_SECRET,
        maxUploadBytes: MAX_UPLOAD_BYTES,
        now: () => now,
        quotas,
      })).toThrow('PILOT_EVIDENCE_QUOTA_INVALID');
    }
  });

  it('counts accepted objects and declared bytes, and accepts a token at most once concurrently', async () => {
    const limited = new LocalPilotObjectStorage({
      rootDir,
      signingSecret: SIGNING_SECRET,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      now: () => now,
      quotas: {
        maxObjectsPerOrder: 1,
        maxObjectsPerActor: 1,
        maxTotalObjects: 1,
        maxBytesPerOrder: PNG_BYTES.length,
        maxBytesPerActor: PNG_BYTES.length,
        maxTotalBytes: PNG_BYTES.length,
      },
    });
    const issued = await limited.issueUpload({
      objectKey: 'orders/order-a/evidence-a',
      mimeType: 'image/png', sizeBytes: PNG_BYTES.length, sha256: sha256(PNG_BYTES),
      expiresInSeconds: 600,
      quotaScope: { actorId: 'actor-a', orderId: 'order-a' },
    });
    const accepted = await Promise.allSettled([
      limited.acceptUpload(tokenFrom(issued.uploadUrl), PNG_BYTES),
      limited.acceptUpload(tokenFrom(issued.uploadUrl), PNG_BYTES),
    ]);
    expect(accepted.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(accepted.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await expect(limited.issueUpload({
      objectKey: 'orders/order-b/evidence-b',
      mimeType: 'image/png', sizeBytes: PNG_BYTES.length, sha256: sha256(PNG_BYTES),
      expiresInSeconds: 600,
      quotaScope: { actorId: 'actor-b', orderId: 'order-b' },
    })).rejects.toThrow('EVIDENCE_QUOTA_EXCEEDED');
    expect((await entries()).filter((entry) => entry.includes('.tmp-'))).toEqual([]);
  });

  it('serializes quotas and same-token acceptance across storage instances sharing a root', async () => {
    const options = {
      rootDir,
      signingSecret: SIGNING_SECRET,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      now: () => now,
      quotas: {
        maxObjectsPerOrder: 1,
        maxObjectsPerActor: 1,
        maxTotalObjects: 1,
        maxBytesPerOrder: PNG_BYTES.length,
        maxBytesPerActor: PNG_BYTES.length,
        maxTotalBytes: PNG_BYTES.length,
      },
    };
    const first = new LocalPilotObjectStorage(options);
    const second = new LocalPilotObjectStorage(options);
    const request = (suffix: string) => ({
      objectKey: `orders/order-shared/${suffix}`,
      mimeType: 'image/png',
      sizeBytes: PNG_BYTES.length,
      sha256: sha256(PNG_BYTES),
      expiresInSeconds: 600,
      quotaScope: { actorId: 'actor-shared', orderId: 'order-shared' },
    });
    const issued = await Promise.allSettled([
      first.issueUpload(request('evidence-a')),
      second.issueUpload(request('evidence-b')),
    ]);
    expect(issued.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(issued.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const winner = (issued.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<{
      objectKey: string; uploadUrl: string;
    }>).value;
    const accepted = await Promise.allSettled([
      first.acceptUpload(tokenFrom(winner.uploadUrl), PNG_BYTES),
      second.acceptUpload(tokenFrom(winner.uploadUrl), PNG_BYTES),
    ]);
    expect(accepted.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(accepted.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await first.verifyUpload(winner.objectKey, {
      mimeType: 'image/png', sizeBytes: PNG_BYTES.length, sha256: sha256(PNG_BYTES),
    })).toBe(true);
  });

  it('creates an authenticated versioned manifest only for an empty root', async () => {
    await storage.initialize();
    const manifest = JSON.parse(await readFile(path.join(rootDir, MANIFEST_NAME), 'utf8')) as Record<string, unknown>;
    expect(manifest).toMatchObject({ formatVersion: 1 });
    expect(manifest.keyId).toMatch(/^[a-f0-9]{16}$/);
    expect(manifest.integrity).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(manifest).sort()).toEqual(['formatVersion', 'integrity', 'keyId']);
  });

  it('fails closed without modifying a legacy non-empty root that lacks a manifest', async () => {
    const legacyObject = 'a'.repeat(64);
    await writeFile(path.join(rootDir, legacyObject), PNG_BYTES);
    await writeFile(path.join(rootDir, `${legacyObject}.json`), '{"legacy":true}');
    const before = await entries();

    await expect(storage.initialize()).rejects.toThrow('EVIDENCE_STORAGE_UNAVAILABLE');
    expect(await entries()).toEqual(before);
  });

  it('fails closed on signing-key or manifest-version mismatch without scavenging valid pairs', async () => {
    const issued = await issue();
    await storage.acceptUpload(tokenFrom(issued.uploadUrl), PNG_BYTES);
    const before = await entries();
    const wrongKey = new LocalPilotObjectStorage({
      rootDir, signingSecret: Buffer.alloc(32, 0x19), maxUploadBytes: MAX_UPLOAD_BYTES, now: () => now,
    });
    await expect(wrongKey.initialize()).rejects.toThrow('EVIDENCE_STORAGE_UNAVAILABLE');
    expect(await entries()).toEqual(before);

    const manifestPath = path.join(rootDir, MANIFEST_NAME);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.formatVersion = 999;
    await writeFile(manifestPath, JSON.stringify(manifest));
    const unknownVersion = new LocalPilotObjectStorage({
      rootDir, signingSecret: SIGNING_SECRET, maxUploadBytes: MAX_UPLOAD_BYTES, now: () => now,
    });
    const versionBefore = await entries();
    await expect(unknownVersion.initialize()).rejects.toThrow('EVIDENCE_STORAGE_UNAVAILABLE');
    expect(await entries()).toEqual(versionBefore);
  });

  it('atomically quarantines one observed stale lease across isolated module instances', async () => {
    await storage.initialize();
    const staleId = '11111111-1111-4111-8111-111111111111';
    await writeFile(path.join(rootDir, `.pilot-storage.lease.${staleId}`), JSON.stringify({
      id: staleId, pid: 2_147_483_647, createdAt: 1,
    }));
    vi.resetModules();
    const FirstStorage = (await import('../src/adapters/local-pilot-object-storage.js'))
      .LocalPilotObjectStorage;
    vi.resetModules();
    const SecondStorage = (await import('../src/adapters/local-pilot-object-storage.js'))
      .LocalPilotObjectStorage;
    expect(FirstStorage).not.toBe(SecondStorage);
    const first = new FirstStorage({
      rootDir, signingSecret: SIGNING_SECRET, maxUploadBytes: MAX_UPLOAD_BYTES, now: () => now,
    });
    const second = new SecondStorage({
      rootDir, signingSecret: SIGNING_SECRET, maxUploadBytes: MAX_UPLOAD_BYTES, now: () => now,
    });

    await expect(Promise.all([first.initialize(), second.initialize()])).resolves.toEqual([undefined, undefined]);
    expect((await entries()).filter((name) => name.includes('.pilot-storage.lease')
      || name.includes('.pilot-storage.stale'))).toEqual([]);
  });

  it('scavenges stale temporary and incomplete pairs while preserving valid objects', async () => {
    const issued = await issue();
    await storage.acceptUpload(tokenFrom(issued.uploadUrl), PNG_BYTES);
    const orphanObject = 'a'.repeat(64);
    const orphanMetadata = 'b'.repeat(64);
    await writeFile(path.join(rootDir, `${'c'.repeat(64)}.tmp-11111111-1111-4111-8111-111111111111`), 'temp');
    await writeFile(path.join(rootDir, orphanObject), 'orphan');
    await writeFile(path.join(rootDir, `${orphanMetadata}.json`), '{}');

    const restarted = new LocalPilotObjectStorage({
      rootDir,
      signingSecret: SIGNING_SECRET,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      now: () => now,
    });
    await restarted.initialize();

    expect(await restarted.verifyUpload(issued.objectKey, {
      mimeType: 'image/png', sizeBytes: PNG_BYTES.length, sha256: sha256(PNG_BYTES),
    })).toBe(true);
    expect((await entries()).filter((entry) => entry.includes('.tmp-'))).toEqual([]);
    expect(await entries()).not.toContain(orphanObject);
    expect(await entries()).not.toContain(`${orphanMetadata}.json`);
    expect(await entries()).toHaveLength(3);
  });

  it('scavenges an exact-shape malformed record instead of wedging initialization', async () => {
    await storage.initialize();
    const base = 'd'.repeat(64);
    await writeFile(path.join(rootDir, base), PNG_BYTES);
    await writeFile(path.join(rootDir, `${base}.json`), JSON.stringify({
      actorId: 'actor-a',
      integrity: '0'.repeat(64),
      kind: 'object',
      mimeType: 'image/png',
      objectKey: '../outside',
      orderId: 'order-a',
      sha256: sha256(PNG_BYTES),
      sizeBytes: PNG_BYTES.length,
    }));
    const restarted = new LocalPilotObjectStorage({
      rootDir,
      signingSecret: SIGNING_SECRET,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      now: () => now,
    });

    await expect(restarted.initialize()).resolves.toBeUndefined();
    expect(await entries()).not.toContain(base);
    expect(await entries()).not.toContain(`${base}.json`);
  });

  it('normalizes lazy initialization and native storage failures from every public method', async () => {
    const issued = await issue();
    await storage.acceptUpload(tokenFrom(issued.uploadUrl), PNG_BYTES);
    const readToken = tokenFrom(await storage.issueReadUrl(issued.objectKey, 300));
    await writeFile(path.join(rootDir, MANIFEST_NAME), '{"nativePath":"C:\\\\private-evidence"}');
    const restarted = new LocalPilotObjectStorage({
      rootDir, signingSecret: SIGNING_SECRET, maxUploadBytes: MAX_UPLOAD_BYTES, now: () => now,
    });
    const expected = { mimeType: 'image/png', sizeBytes: PNG_BYTES.length, sha256: sha256(PNG_BYTES) };
    const validRequest = {
      objectKey: 'orders/11111111-1111-4111-8111-111111111111/another',
      ...expected,
      expiresInSeconds: 600,
      quotaScope: {
        actorId: 'actor-11111111', orderId: '11111111-1111-4111-8111-111111111111',
      },
    };

    for (const call of [
      () => restarted.initialize(),
      () => restarted.issueUpload(validRequest),
      () => restarted.acceptUpload(tokenFrom(issued.uploadUrl), PNG_BYTES),
      () => restarted.verifyUpload(issued.objectKey, expected),
      () => restarted.issueReadUrl(issued.objectKey, 300),
      () => restarted.readObject(readToken),
    ]) {
      await expect(call()).rejects.toThrow('EVIDENCE_STORAGE_UNAVAILABLE');
    }
  });

  it('rejects a configured evidence path with a junction ancestor before writing', async () => {
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'petcare-evidence-ancestor-target-'));
    const junctionAncestor = path.join(rootDir, 'linked-ancestor');
    try {
      await symlink(outsideDir, junctionAncestor, 'junction');
      const unsafe = new LocalPilotObjectStorage({
        rootDir: path.join(junctionAncestor, 'evidence'),
        signingSecret: SIGNING_SECRET,
        maxUploadBytes: MAX_UPLOAD_BYTES,
        now: () => now,
      });

      await expect(unsafe.initialize()).rejects.toThrow('FORBIDDEN');
      expect(await readdir(outsideDir)).toEqual([]);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});

describe('registerLocalUploadRoutes', () => {
  let rootDir: string;
  let app: ReturnType<typeof Fastify>;
  let storage: LocalPilotObjectStorage;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), 'petcare-local-evidence-routes-'));
    storage = new LocalPilotObjectStorage({
      rootDir,
      signingSecret: SIGNING_SECRET,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      now: () => new Date('2026-08-27T12:00:00.000Z'),
    });
    app = Fastify({ logger: false });
    await app.register(registerLocalUploadRoutes, { storage, maxUploadBytes: MAX_UPLOAD_BYTES });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  it('accepts only raw bytes and serves signed reads privately with the stored MIME type', async () => {
    const issued = await storage.issueUpload({
      objectKey: 'orders/11111111-1111-4111-8111-111111111111/evidence-route',
      mimeType: 'image/png', sizeBytes: PNG_BYTES.length, sha256: sha256(PNG_BYTES),
      expiresInSeconds: 600,
      quotaScope: {
        actorId: 'actor-11111111',
        orderId: '11111111-1111-4111-8111-111111111111',
      },
    });
    const uploadUrl = new URL(issued.uploadUrl, 'http://pilot');

    const rejectedType = await app.inject({
      method: 'PUT', url: `${uploadUrl.pathname}${uploadUrl.search}`,
      headers: { 'content-type': 'image/png' }, payload: PNG_BYTES,
    });
    expect(rejectedType.statusCode).toBe(415);

    const uploaded = await app.inject({
      method: 'PUT', url: `${uploadUrl.pathname}${uploadUrl.search}`,
      headers: { 'content-type': 'application/octet-stream' }, payload: PNG_BYTES,
    });
    expect(uploaded.statusCode).toBe(204);

    const readUrl = new URL(await storage.issueReadUrl(issued.objectKey, 300), 'http://pilot');
    const read = await app.inject({ method: 'GET', url: `${readUrl.pathname}${readUrl.search}` });
    expect(read.statusCode).toBe(200);
    expect(read.headers['content-type']).toBe('image/png');
    expect(read.headers['cache-control']).toBe('private, no-store');
    expect(read.rawPayload).toEqual(PNG_BYTES);
  });

  it('returns fixed errors that do not reveal tokens, secrets, addresses, or filesystem paths', async () => {
    const invalidToken = 'not-a-valid-token-with-address-中山路99号';
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/pilot/local-evidence?token=${encodeURIComponent(invalidToken)}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: PNG_BYTES,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: 'FORBIDDEN' });
    expect(response.body).not.toContain(invalidToken);
    expect(response.body).not.toContain(rootDir);
    expect(response.body).not.toContain(SIGNING_SECRET.toString('hex'));
    expect(await readdir(rootDir)).toEqual([]);
  });

  it('returns a fixed quota error from local capability routes', async () => {
    const quotaApp = Fastify({ logger: false });
    await quotaApp.register(registerLocalUploadRoutes, {
      maxUploadBytes: MAX_UPLOAD_BYTES,
      storage: {
        acceptUpload: async () => { throw new Error('EVIDENCE_QUOTA_EXCEEDED'); },
        readObject: async () => { throw new Error('FORBIDDEN'); },
      },
    });
    try {
      const response = await quotaApp.inject({
        method: 'PUT',
        url: '/api/v1/pilot/local-evidence?token=opaque',
        headers: { 'content-type': 'application/octet-stream' },
        payload: PNG_BYTES,
      });
      expect(response.statusCode).toBe(429);
      expect(response.json()).toEqual({ code: 'EVIDENCE_QUOTA_EXCEEDED' });
    } finally {
      await quotaApp.close();
    }
  });

  it('returns a fixed quota error from authenticated evidence issuance', async () => {
    const serviceApp = createApp({
      auth: {
        authenticate: async () => ({ userId: 'provider-1', role: 'PROVIDER' as const }),
      },
      pets: {} as never,
      addresses: {} as never,
      fulfillment: {
        issueUpload: async () => { throw new Error('EVIDENCE_QUOTA_EXCEEDED'); },
      } as never,
    });
    const response = await serviceApp.inject({
      method: 'POST',
      url: '/v1/orders/order-1/evidence/uploads',
      headers: { authorization: 'Bearer provider-1' },
      payload: {
        mimeType: 'image/png',
        sizeBytes: PNG_BYTES.length,
        sha256: sha256(PNG_BYTES),
      },
    });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ code: 'EVIDENCE_QUOTA_EXCEEDED' });
    await serviceApp.close();
  });

  it('returns a fixed service error without leaking native storage paths', async () => {
    const serviceApp = createApp({
      auth: {
        authenticate: async () => ({ userId: 'provider-1', role: 'PROVIDER' as const }),
      },
      pets: {} as never,
      addresses: {} as never,
      fulfillment: {
        issueUpload: async () => { throw new Error('EVIDENCE_STORAGE_UNAVAILABLE'); },
      } as never,
    });
    const response = await serviceApp.inject({
      method: 'POST',
      url: '/v1/orders/order-1/evidence/uploads',
      headers: { authorization: 'Bearer provider-1' },
      payload: {
        mimeType: 'image/png',
        sizeBytes: PNG_BYTES.length,
        sha256: sha256(PNG_BYTES),
      },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ code: 'SERVICE_UNAVAILABLE' });
    expect(response.body).not.toContain('C:\\private-evidence');
    await serviceApp.close();
  });

  it('does not echo an unexpected native storage error on the authenticated non-pilot route', async () => {
    const nativePath = 'EACCES: denied C:\\private-evidence\\secret-object';
    const serviceApp = createApp({
      auth: {
        authenticate: async () => ({ userId: 'provider-1', role: 'PROVIDER' as const }),
      },
      pets: {} as never,
      addresses: {} as never,
      fulfillment: {
        issueUpload: async () => { throw new Error(nativePath); },
      } as never,
    });
    const response = await serviceApp.inject({
      method: 'POST',
      url: '/v1/orders/order-1/evidence/uploads',
      headers: { authorization: 'Bearer provider-1' },
      payload: {
        mimeType: 'image/png', sizeBytes: PNG_BYTES.length, sha256: sha256(PNG_BYTES),
      },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ code: 'SERVICE_UNAVAILABLE' });
    expect(response.body).not.toContain(nativePath);
    await serviceApp.close();
  });
});
