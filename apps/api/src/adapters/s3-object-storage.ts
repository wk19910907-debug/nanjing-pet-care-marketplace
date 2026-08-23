import type { ObjectStorage } from './object-storage.js';

export interface S3Signer {
  presignPut(input: { objectKey: string; mimeType: string; sizeBytes: number; sha256: string; expiresInSeconds: number }): Promise<string>;
  presignGet(input: { objectKey: string; expiresInSeconds: number }): Promise<string>;
  head(objectKey: string): Promise<{ mimeType: string; sizeBytes: number; sha256: string } | null>;
}

export class S3ObjectStorage implements ObjectStorage {
  public constructor(private readonly signer: S3Signer) {}
  public async issueUpload(input: {
    objectKey: string; mimeType: string; sizeBytes: number; sha256: string; expiresInSeconds: number;
  }) {
    return { objectKey: input.objectKey, uploadUrl: await this.signer.presignPut(input), expiresInSeconds: input.expiresInSeconds };
  }
  public async verifyUpload(objectKey: string, expected: { mimeType: string; sizeBytes: number; sha256: string }) {
    const actual = await this.signer.head(objectKey);
    return actual?.mimeType === expected.mimeType && actual.sizeBytes === expected.sizeBytes && actual.sha256 === expected.sha256;
  }
  public issueReadUrl(objectKey: string, expiresInSeconds: number) {
    return this.signer.presignGet({ objectKey, expiresInSeconds });
  }
}
