import {
  GetObjectCommand,
  HeadBucketCommand,
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
  unhoistableHeaders?: Set<string>;
};

type AwsS3SignerDependencies = {
  createClient?: (endpoint: string) => AwsS3SignerClient;
  presign?: (command: SignedCommand, options: PresignOptions) => Promise<string>;
  sendHead?: (command: HeadObjectCommand) => Promise<HeadObjectCommandOutput>;
  sendProbe?: (command: HeadBucketCommand, options: { abortSignal: AbortSignal }) => Promise<unknown>;
};

type AwsS3SignerClient = {
  presign(command: SignedCommand, options: PresignOptions): Promise<string>;
  sendHead(command: HeadObjectCommand): Promise<HeadObjectCommandOutput>;
  sendProbe(command: HeadBucketCommand, options: { abortSignal: AbortSignal }): Promise<unknown>;
};

function createClient(config: ObjectStorageConfig, endpoint: string): AwsS3SignerClient {
  const client = new S3Client({
    endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return {
    presign: (command, options) => getSignedUrl(client, command, options),
    sendHead: (command) => client.send(command),
    sendProbe: (command, options) => client.send(command, options),
  };
}

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
  const internalClient = dependencies?.createClient
    ? dependencies.createClient(config.endpoint)
    : createClient(config, config.endpoint);
  const signingClient = config.publicEndpoint && config.publicEndpoint !== config.endpoint
    ? (dependencies?.createClient
      ? dependencies.createClient(config.publicEndpoint)
      : createClient(config, config.publicEndpoint))
    : internalClient;
  const presign = dependencies?.createClient
    ? signingClient.presign.bind(signingClient)
    : dependencies?.presign ?? signingClient.presign.bind(signingClient);
  const sendHead = dependencies?.createClient
    ? internalClient.sendHead.bind(internalClient)
    : dependencies?.sendHead ?? internalClient.sendHead.bind(internalClient);
  const sendProbe = dependencies?.createClient
    ? internalClient.sendProbe.bind(internalClient)
    : dependencies?.sendProbe ?? internalClient.sendProbe.bind(internalClient);

  return {
    probe: async () => {
      try {
        await sendProbe(
          new HeadBucketCommand({ Bucket: config.bucket }),
          { abortSignal: AbortSignal.timeout(3_000) },
        );
        return true;
      } catch {
        return false;
      }
    },
    presignPut: (input) => presign(new PutObjectCommand({
      Bucket: config.bucket,
      Key: input.objectKey,
      ContentType: input.mimeType,
      ContentLength: input.sizeBytes,
      ChecksumSHA256: Buffer.from(input.sha256, 'hex').toString('base64'),
    }), {
      expiresIn: input.expiresInSeconds,
      signableHeaders: new Set(['content-type']),
      unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
    }),
    presignGet: (input) => presign(new GetObjectCommand({
      Bucket: config.bucket, Key: input.objectKey,
    }), { expiresIn: input.expiresInSeconds }),
    head: async (objectKey) => {
      try {
        const output = await sendHead(new HeadObjectCommand({
          Bucket: config.bucket, Key: objectKey, ChecksumMode: 'ENABLED',
        }));
        // Only storage-verified full-object checksums count. User metadata is not proof.
        const checksum = output.ChecksumSHA256 ?? '';
        const sha256 = output.ChecksumType !== 'COMPOSITE' && /^[A-Za-z0-9+/]{43}=$/.test(checksum)
          ? Buffer.from(checksum, 'base64').toString('hex') : '';
        return {
          mimeType: output.ContentType ?? '',
          sizeBytes: output.ContentLength ?? -1,
          sha256,
        };
      } catch (error) {
        if (isMissingObject(error)) return null;
        throw error;
      }
    },
  };
}
