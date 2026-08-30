import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ObjectStorageConfig } from '../config.js';
import type { S3Signer } from './s3-object-storage.js';

type SignedCommand = PutObjectCommand | GetObjectCommand;
type PresignOptions = {
  expiresIn: number;
  signableHeaders?: Set<string>;
  hoistableHeaders?: Set<string>;
};

type AwsS3SignerDependencies = {
  presign(command: SignedCommand, options: PresignOptions): Promise<string>;
  sendHead(command: HeadObjectCommand): Promise<HeadObjectCommandOutput>;
};

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.name === 'NotFound' || candidate.name === 'NoSuchKey'
    || candidate.$metadata?.httpStatusCode === 404;
}

export function createAwsS3Signer(
  config: ObjectStorageConfig,
  dependencies?: AwsS3SignerDependencies,
): S3Signer {
  const client = dependencies ? undefined : new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const presign = dependencies?.presign ?? ((command: SignedCommand, options: PresignOptions) => (
    getSignedUrl(client!, command, options)
  ));
  const sendHead = dependencies?.sendHead ?? ((command: HeadObjectCommand) => client!.send(command));

  return {
    presignPut: (input) => presign(new PutObjectCommand({
      Bucket: config.bucket,
      Key: input.objectKey,
      ContentType: input.mimeType,
      ContentLength: input.sizeBytes,
      Metadata: { sha256: input.sha256 },
    }), {
      expiresIn: input.expiresInSeconds,
      signableHeaders: new Set(['content-type']),
      hoistableHeaders: new Set(['x-amz-meta-sha256']),
    }),
    presignGet: (input) => presign(new GetObjectCommand({
      Bucket: config.bucket, Key: input.objectKey,
    }), { expiresIn: input.expiresInSeconds }),
    head: async (objectKey) => {
      try {
        const output = await sendHead(new HeadObjectCommand({ Bucket: config.bucket, Key: objectKey }));
        return {
          mimeType: output.ContentType ?? '',
          sizeBytes: output.ContentLength ?? -1,
          sha256: output.Metadata?.sha256 ?? '',
        };
      } catch (error) {
        if (isMissingObject(error)) return null;
        throw error;
      }
    },
  };
}
