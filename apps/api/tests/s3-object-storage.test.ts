import { expect, it } from 'vitest';
import { S3ObjectStorage } from '../src/adapters/s3-object-storage.js';

it('compares SHA-256 hex case-insensitively, as accepted by the evidence API', async () => {
  const storage = new S3ObjectStorage({
    probe: async () => true,
    presignPut: async () => 'https://objects.example/upload',
    presignGet: async () => 'https://objects.example/read',
    head: async () => ({ mimeType: 'image/png', sizeBytes: 4, sha256: 'ab'.repeat(32) }),
  });
  await expect(storage.verifyUpload('photo', {
    mimeType: 'image/png', sizeBytes: 4, sha256: 'AB'.repeat(32),
  })).resolves.toBe(true);
});
