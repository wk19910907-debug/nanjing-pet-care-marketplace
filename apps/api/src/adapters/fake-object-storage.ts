import type { ObjectStorage, UploadDescriptor } from './object-storage.js';

type StoredUpload = { mimeType: string; sizeBytes: number; sha256: string; completed: boolean };

export class FakeObjectStorage implements ObjectStorage {
  private readonly uploads = new Map<string, StoredUpload>();

  public async issueUpload(input: {
    objectKey: string; mimeType: string; sizeBytes: number; sha256: string; expiresInSeconds: number;
  }): Promise<UploadDescriptor> {
    this.uploads.set(input.objectKey, { ...input, completed: false });
    return {
      objectKey: input.objectKey,
      uploadUrl: `https://storage.invalid/upload-token/${encodeURIComponent(input.objectKey)}`,
      expiresInSeconds: input.expiresInSeconds,
    };
  }

  public completeUpload(objectKey: string): void {
    const upload = this.uploads.get(objectKey);
    if (!upload) throw new Error('UPLOAD_NOT_ISSUED');
    upload.completed = true;
  }

  public async verifyUpload(
    objectKey: string,
    expected: { mimeType: string; sizeBytes: number; sha256: string },
  ): Promise<boolean> {
    const upload = this.uploads.get(objectKey);
    return Boolean(upload?.completed
      && upload.mimeType === expected.mimeType
      && upload.sizeBytes === expected.sizeBytes
      && upload.sha256 === expected.sha256);
  }

  public async issueReadUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
    return `https://storage.invalid/read-token/${encodeURIComponent(objectKey)}?ttl=${expiresInSeconds}`;
  }
}
