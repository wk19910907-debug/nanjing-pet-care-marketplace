export type UploadDescriptor = {
  objectKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
};

export interface ObjectStorage {
  issueUpload(input: {
    objectKey: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    expiresInSeconds: number;
  }): Promise<UploadDescriptor>;
  verifyUpload(objectKey: string, expected: {
    mimeType: string; sizeBytes: number; sha256: string;
  }): Promise<boolean>;
  issueReadUrl(objectKey: string, expiresInSeconds: number): Promise<string>;
}
