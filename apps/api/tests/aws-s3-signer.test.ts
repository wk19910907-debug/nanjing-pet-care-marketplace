import { describe, expect, it, vi } from 'vitest';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createAwsS3Signer } from '../src/adapters/aws-s3-signer.js';

const config = {
  endpoint: 'https://objects.example.com', bucket: 'private-evidence',
  accessKeyId: 'access-id', secretAccessKey: 'secret-key',
  region: 'auto', forcePathStyle: true,
};

describe('createAwsS3Signer', () => {
  it('presigns bounded private uploads and reads without exposing credentials', async () => {
    const commands: Array<PutObjectCommand | GetObjectCommand> = [];
    const options: unknown[] = [];
    const presign = vi.fn(async (command: PutObjectCommand | GetObjectCommand, input: unknown) => {
      commands.push(command);
      options.push(input);
      return command instanceof PutObjectCommand ? 'https://objects.example.com/upload?signed=1' : 'https://objects.example.com/read?signed=1';
    });
    const signer = createAwsS3Signer(config, { presign, sendHead: vi.fn() });

    await expect(signer.presignPut({
      objectKey: 'orders/order-1/evidence-1', mimeType: 'image/jpeg', sizeBytes: 123,
      sha256: 'ab'.repeat(32), expiresInSeconds: 600,
    })).resolves.toBe('https://objects.example.com/upload?signed=1');
    await expect(signer.presignGet({ objectKey: 'orders/order-1/evidence-1', expiresInSeconds: 300 }))
      .resolves.toBe('https://objects.example.com/read?signed=1');

    expect(commands[0]).toBeInstanceOf(PutObjectCommand);
    expect(commands[0]!.input).toEqual({
      Bucket: 'private-evidence', Key: 'orders/order-1/evidence-1',
      ContentType: 'image/jpeg', ContentLength: 123, Metadata: { sha256: 'ab'.repeat(32) },
    });
    expect(options[0]).toEqual({
      expiresIn: 600,
      signableHeaders: new Set(['content-type']),
      hoistableHeaders: new Set(['x-amz-meta-sha256']),
    });
    expect(commands[1]).toBeInstanceOf(GetObjectCommand);
    expect(commands[1]!.input).toEqual({ Bucket: 'private-evidence', Key: 'orders/order-1/evidence-1' });
    expect(options[1]).toEqual({ expiresIn: 300 });
    expect(JSON.stringify(commands)).not.toContain(config.secretAccessKey);
  });

  it('normalizes HEAD metadata and treats only missing objects as absent', async () => {
    const sendHead = vi.fn()
      .mockResolvedValueOnce({ ContentType: 'image/png', ContentLength: 456, Metadata: { sha256: 'cd'.repeat(32) } })
      .mockRejectedValueOnce({ name: 'NotFound', $metadata: { httpStatusCode: 404 } })
      .mockRejectedValueOnce(new Error('storage unavailable'));
    const signer = createAwsS3Signer(config, { presign: vi.fn(), sendHead });

    await expect(signer.head('orders/order-1/evidence-1')).resolves.toEqual({
      mimeType: 'image/png', sizeBytes: 456, sha256: 'cd'.repeat(32),
    });
    expect(sendHead.mock.calls[0]![0]).toBeInstanceOf(HeadObjectCommand);
    expect(sendHead.mock.calls[0]![0].input).toEqual({ Bucket: 'private-evidence', Key: 'orders/order-1/evidence-1' });
    await expect(signer.head('missing')).resolves.toBeNull();
    await expect(signer.head('broken')).rejects.toThrow('storage unavailable');
  });
});
