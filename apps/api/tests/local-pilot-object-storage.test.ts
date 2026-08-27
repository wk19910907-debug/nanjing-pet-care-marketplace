import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalPilotObjectStorage } from '../src/adapters/local-pilot-object-storage.js';
import { registerLocalUploadRoutes } from '../src/pilot/local-upload-routes.js';

const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
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
    return storage.issueUpload({
      objectKey,
      mimeType: 'image/png',
      sizeBytes: PNG_BYTES.length,
      sha256: sha256(PNG_BYTES),
      expiresInSeconds: 600,
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
    expect(await entries()).toHaveLength(2);
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

      expect(await junctionStorage.verifyUpload(issued.objectKey, {
        mimeType: 'image/png', sizeBytes: PNG_BYTES.length, sha256: sha256(PNG_BYTES),
      })).toBe(false);
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
    expect(await entries()).toEqual([]);
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
});
