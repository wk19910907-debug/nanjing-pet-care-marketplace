export type UploadDescriptor = {
  objectKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
  uploadHeaders?: { 'x-amz-checksum-sha256': string };
};

export type EvidenceQuotaScope = {
  actorId: string;
  orderId: string;
};

export type UploadRequest = {
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  expiresInSeconds: number;
  quotaScope?: EvidenceQuotaScope;
};

export interface ObjectStorage {
  issueUpload(input: UploadRequest): Promise<UploadDescriptor>;
  verifyUpload(objectKey: string, expected: {
    mimeType: string; sizeBytes: number; sha256: string;
  }): Promise<boolean>;
  issueReadUrl(objectKey: string, expiresInSeconds: number): Promise<string>;
}
