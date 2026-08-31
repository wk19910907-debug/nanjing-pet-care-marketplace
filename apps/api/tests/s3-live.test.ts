import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { CreateBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAwsS3Signer } from '../src/adapters/aws-s3-signer.js';
import { S3ObjectStorage } from '../src/adapters/s3-object-storage.js';

// Opt-in: creates only an isolated, loopback-only container with no host volumes.
describe.skipIf(process.env.PET_S3_LIVE_TEST !== '1')('real private S3 storage', () => {
  let containerId = '';
  let client: S3Client;
  let storage: S3ObjectStorage;
  const bucket = 'test-evidence';
  const bytes = Buffer.from('synthetic-evidence-only');
  const expected = {
    mimeType: 'image/jpeg', sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  const docker = (args: string[], env = process.env) => execFileSync('docker', args, {
    encoding: 'utf8', timeout: 30_000, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

  beforeAll(async () => {
    const accessKeyId = randomBytes(12).toString('hex');
    const secretAccessKey = randomBytes(32).toString('hex');
    containerId = docker([
      'run', '--detach', '--rm', '--name', `pet-s3-test-${randomUUID()}`,
      '--label', 'petcare.test=s3-live', '--publish', '127.0.0.1::9000',
      '--env', 'MINIO_ROOT_USER', '--env', 'MINIO_ROOT_PASSWORD',
      process.env.PET_S3_TEST_IMAGE ?? 'minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e', 'server', '/data',
    ], { ...process.env, MINIO_ROOT_USER: accessKeyId, MINIO_ROOT_PASSWORD: secretAccessKey });
    if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error('Invalid test container ID');
    const address = docker(['port', containerId, '9000/tcp']);
    if (!/^127\.0\.0\.1:\d+$/.test(address)) throw new Error('Test storage must be loopback-only');
    const endpoint = `http://${address}`;
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      ready = await fetch(`${endpoint}/minio/health/ready`, { signal: AbortSignal.timeout(1000) })
        .then((response) => response.ok).catch(() => false);
      if (ready) break;
      await delay(200);
    }
    if (!ready) throw new Error('Isolated test storage did not become ready');
    const config = { endpoint, bucket, accessKeyId, secretAccessKey, region: 'us-east-1', forcePathStyle: true };
    client = new S3Client({ ...config, credentials: { accessKeyId, secretAccessKey } });
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    storage = new S3ObjectStorage(createAwsS3Signer(config));
  }, 60_000);

  afterAll(() => {
    client?.destroy();
    if (/^[a-f0-9]{64}$/.test(containerId)
      && docker(['inspect', '--format', '{{index .Config.Labels "petcare.test"}}', containerId]) === 's3-live') {
      docker(['rm', '--force', containerId]);
    }
  });

  const upload = async (objectKey: string) => storage.issueUpload({
    objectKey, ...expected, expiresInSeconds: 60,
  });
  const put = async (url: string, body: Buffer, contentType = expected.mimeType, withChecksum = true) => {
    const response = await fetch(url, { method: 'PUT', headers: {
      'Content-Type': contentType,
      ...(withChecksum ? { 'x-amz-checksum-sha256': Buffer.from(expected.sha256, 'hex').toString('base64') } : {}),
    }, body: new Uint8Array(body) });
    // Report only status/error code, never a signed URL or credentials.
    const error = response.ok ? '' : (await response.text()).match(/<Code>([^<]+)<\/Code>/)?.[1];
    return { status: response.status, error };
  };

  it('uploads, verifies and reads the exact bytes using the current client headers', async () => {
    const issued = await upload('roundtrip');
    expect(issued).toHaveProperty('uploadHeaders', {
      'x-amz-checksum-sha256': Buffer.from(expected.sha256, 'hex').toString('base64'),
    });
    const { uploadUrl } = issued;
    expect(await put(uploadUrl, bytes)).toEqual({ status: 200, error: '' });
    expect(await storage.verifyUpload('roundtrip', expected)).toBe(true);
    expect(await storage.verifyUpload('roundtrip', { ...expected, sha256: expected.sha256.toUpperCase() })).toBe(true);
    const readUrl = await storage.issueReadUrl('roundtrip', 60);
    const response = await fetch(readUrl);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect((await fetch(readUrl.split('?')[0]!)).status).toBe(403);
  });

  it('rejects a different same-length payload', async () => {
    const { uploadUrl } = await upload('wrong-bytes');
    const result = await put(uploadUrl, Buffer.alloc(bytes.length, 65));
    expect(result.status).toBe(400);
    expect(result.error).toBe('XAmzContentChecksumMismatch');
    expect(await storage.verifyUpload('wrong-bytes', expected)).toBe(false);
  });

  it('does not trust client-supplied checksum metadata', async () => {
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: 'forged-metadata', Body: Buffer.alloc(bytes.length, 65),
      ContentType: expected.mimeType, Metadata: { sha256: expected.sha256 },
    }));
    expect(await storage.verifyUpload('forged-metadata', expected)).toBe(false);
  });

  it('rejects an altered content type', async () => {
    const { uploadUrl } = await upload('wrong-type');
    expect((await put(uploadUrl, bytes, 'text/plain')).status).toBe(403);
    expect(await storage.verifyUpload('wrong-type', expected)).toBe(false);
  });

  it('rejects a tampered signed object key', async () => {
    const { uploadUrl } = await upload('original-key');
    expect((await put(uploadUrl.replace('/original-key?', '/other-key?'), bytes)).status).toBe(403);
  });

  it('cannot replace verified evidence by omitting the checksum header on replay', async () => {
    const { uploadUrl } = await upload('replay');
    expect((await put(uploadUrl, bytes)).status).toBe(200);
    expect([400, 403]).toContain((await put(uploadUrl, Buffer.alloc(bytes.length, 65), expected.mimeType, false)).status);
    expect((await put(uploadUrl, Buffer.alloc(bytes.length, 65))).status).toBe(400);
    expect(await storage.verifyUpload('replay', expected)).toBe(true);
    const response = await fetch(await storage.issueReadUrl('replay', 60));
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });

  it('reports missing objects as unverified', async () => {
    expect(await storage.verifyUpload('missing', expected)).toBe(false);
  });
});
