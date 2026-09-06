import { describe, expect, it, vi } from 'vitest';
import { GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createAwsS3Signer } from '../src/adapters/aws-s3-signer.js';

const config = {
  endpoint: 'https://objects.example.com', bucket: 'private-evidence',
  accessKeyId: 'access-id', secretAccessKey: 'secret-key',
  region: 'auto', forcePathStyle: true,
};

describe('createAwsS3Signer', () => {
  it('uses the internal endpoint for probes and object heads while presigning through a public endpoint', async () => {
    const internal = {
      presign: vi.fn(async () => 'http://minio:9000/internal-signed-url'),
      sendHead: vi.fn().mockResolvedValue({}),
      sendProbe: vi.fn().mockResolvedValue({}),
    };
    const browser = {
      presign: vi.fn(async () => 'https://storage.petcare.localhost/browser-signed-url'),
      sendHead: vi.fn(),
      sendProbe: vi.fn(),
    };
    const createClient = vi.fn((endpoint: string) => (
      endpoint === 'https://storage.petcare.localhost' ? browser : internal
    ));
    const signer = createAwsS3Signer({
      ...config,
      endpoint: 'http://minio:9000',
      publicEndpoint: 'https://storage.petcare.localhost',
    }, {
      createClient,
    });

    await expect(signer.probe()).resolves.toBe(true);
    await expect(signer.head('orders/order-1/evidence-1')).resolves.toEqual({
      mimeType: '', sizeBytes: -1, sha256: '',
    });
    await expect(signer.presignPut({
      objectKey: 'orders/order-1/evidence-1', mimeType: 'image/jpeg', sizeBytes: 123,
      sha256: 'ab'.repeat(32), expiresInSeconds: 600,
    })).resolves.toBe('https://storage.petcare.localhost/browser-signed-url');
    await expect(signer.presignGet({ objectKey: 'orders/order-1/evidence-1', expiresInSeconds: 300 }))
      .resolves.toBe('https://storage.petcare.localhost/browser-signed-url');

    expect(createClient).toHaveBeenNthCalledWith(1, 'http://minio:9000');
    expect(createClient).toHaveBeenNthCalledWith(2, 'https://storage.petcare.localhost');
    expect(internal.sendProbe).toHaveBeenCalledWith(expect.any(HeadBucketCommand), expect.anything());
    expect(internal.sendHead).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
    expect(browser.sendProbe).not.toHaveBeenCalled();
    expect(browser.sendHead).not.toHaveBeenCalled();
    expect(browser.presign).toHaveBeenCalledTimes(2);
    const serializedCommands = JSON.stringify([
      ...internal.sendProbe.mock.calls, ...internal.sendHead.mock.calls, ...browser.presign.mock.calls,
    ]);
    expect(serializedCommands).not.toContain(config.secretAccessKey);
    expect(serializedCommands).not.toContain('publicEndpoint');
  });

  it('presigns bounded private uploads and reads without exposing credentials', async () => {
    const commands: Array<PutObjectCommand | GetObjectCommand> = [];
    const options: unknown[] = [];
    const presign = vi.fn(async (command: PutObjectCommand | GetObjectCommand, input: unknown) => {
      commands.push(command);
      options.push(input);
      return command instanceof PutObjectCommand ? 'https://objects.example.com/upload?signed=1' : 'https://objects.example.com/read?signed=1';
    });
    const signer = createAwsS3Signer(config, { presign, sendHead: vi.fn(), sendProbe: vi.fn() });

    await expect(signer.presignPut({
      objectKey: 'orders/order-1/evidence-1', mimeType: 'image/jpeg', sizeBytes: 123,
      sha256: 'ab'.repeat(32), expiresInSeconds: 600,
    })).resolves.toBe('https://objects.example.com/upload?signed=1');
    await expect(signer.presignGet({ objectKey: 'orders/order-1/evidence-1', expiresInSeconds: 300 }))
      .resolves.toBe('https://objects.example.com/read?signed=1');

    expect(commands[0]).toBeInstanceOf(PutObjectCommand);
    expect(commands[0]!.input).toEqual({
      Bucket: 'private-evidence', Key: 'orders/order-1/evidence-1',
      ContentType: 'image/jpeg', ContentLength: 123,
      ChecksumSHA256: Buffer.from('ab'.repeat(32), 'hex').toString('base64'),
    });
    expect(options[0]).toEqual({
      expiresIn: 600,
      signableHeaders: new Set(['content-type']),
      unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
    });
    expect(commands[1]).toBeInstanceOf(GetObjectCommand);
    expect(commands[1]!.input).toEqual({ Bucket: 'private-evidence', Key: 'orders/order-1/evidence-1' });
    expect(options[1]).toEqual({ expiresIn: 300 });
    expect(JSON.stringify(commands)).not.toContain(config.secretAccessKey);
  });

  it('reads storage-verified checksums and treats only missing objects as absent', async () => {
    const sendHead = vi.fn()
      .mockResolvedValueOnce({ ContentType: 'image/png', ContentLength: 456,
        ChecksumSHA256: Buffer.from('cd'.repeat(32), 'hex').toString('base64'), Metadata: { sha256: 'ab'.repeat(32) } })
      .mockRejectedValueOnce({ name: 'NotFound', $metadata: { httpStatusCode: 404 } })
      .mockRejectedValueOnce(new Error('storage unavailable'));
    const signer = createAwsS3Signer(config, { presign: vi.fn(), sendHead, sendProbe: vi.fn() });

    await expect(signer.head('orders/order-1/evidence-1')).resolves.toEqual({
      mimeType: 'image/png', sizeBytes: 456, sha256: 'cd'.repeat(32),
    });
    expect(sendHead.mock.calls[0]![0]).toBeInstanceOf(HeadObjectCommand);
    expect(sendHead.mock.calls[0]![0].input).toEqual({ Bucket: 'private-evidence', Key: 'orders/order-1/evidence-1', ChecksumMode: 'ENABLED' });
    await expect(signer.head('missing')).resolves.toBeNull();
    await expect(signer.head('broken')).rejects.toThrow('storage unavailable');
  });

  it.each([
    {},
    { ChecksumSHA256: 'not-a-checksum' },
    { ChecksumSHA256: `${Buffer.from('ab'.repeat(32), 'hex').toString('base64')}-2` },
    { ChecksumSHA256: Buffer.from('ab'.repeat(32), 'hex').toString('base64'), ChecksumType: 'COMPOSITE' },
  ])('fails closed for missing, malformed or composite checksums: %j', async (checksum) => {
    const signer = createAwsS3Signer(config, {
      presign: vi.fn(), sendHead: vi.fn().mockResolvedValue({
        ContentType: 'image/jpeg', ContentLength: 123, Metadata: { sha256: 'ab'.repeat(32) }, ...checksum,
      }), sendProbe: vi.fn(),
    });
    await expect(signer.head('untrusted')).resolves.toEqual({ mimeType: 'image/jpeg', sizeBytes: 123, sha256: '' });
  });

  it('bounds and fails closed when probing bucket access', async () => {
    const sendProbe = vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('storage unavailable'));
    const signer = createAwsS3Signer(config, { presign: vi.fn(), sendHead: vi.fn(), sendProbe });

    await expect(signer.probe()).resolves.toBe(true);
    expect(sendProbe.mock.calls[0]![0]).toBeInstanceOf(HeadBucketCommand);
    expect(sendProbe.mock.calls[0]![0].input).toEqual({ Bucket: 'private-evidence' });
    expect(sendProbe.mock.calls[0]![1]).toMatchObject({ abortSignal: expect.any(AbortSignal) });
    await expect(signer.probe()).resolves.toBe(false);
  });
});
