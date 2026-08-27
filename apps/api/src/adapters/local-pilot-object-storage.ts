import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type { ObjectStorage, UploadDescriptor } from './object-storage.js';

const TOKEN_PURPOSE = 'pilot-local-evidence-v1';
const MAX_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const MAX_OBJECT_KEY_LENGTH = 500;
const MAX_TOKEN_LENGTH = 8_192;
const MAX_METADATA_BYTES = 1_024;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
]);

type Operation = 'upload' | 'read';
type ObjectMetadata = {
  mimeType: string;
  sizeBytes: number;
  sha256: string;
};
type StoredMetadata = ObjectMetadata & { integrity: string };
type CapabilityPayload = ObjectMetadata & {
  operation: Operation;
  objectKey: string;
  expiresAt: number;
};

export type LocalPilotObjectStorageOptions = {
  rootDir: string;
  signingSecret: Buffer;
  maxUploadBytes: number;
  now?: () => Date;
};

export type LocalPilotObject = {
  bytes: Buffer;
  mimeType: string;
};

export class LocalPilotObjectStorage implements ObjectStorage {
  private readonly rootDir: string;
  private readonly signingKey: Buffer;
  private readonly maxUploadBytes: number;
  private readonly now: () => Date;
  private readonly activeWrites = new Set<string>();

  public constructor(options: LocalPilotObjectStorageOptions) {
    if (!path.isAbsolute(options.rootDir)) throw new Error('PILOT_EVIDENCE_DIR_INVALID');
    if (options.signingSecret.length < 32) throw new Error('PILOT_EVIDENCE_SECRET_INVALID');
    if (!Number.isSafeInteger(options.maxUploadBytes) || options.maxUploadBytes <= 0) {
      throw new Error('PILOT_EVIDENCE_SIZE_INVALID');
    }
    this.rootDir = path.resolve(options.rootDir);
    this.signingKey = createHmac('sha256', options.signingSecret)
      .update(TOKEN_PURPOSE, 'utf8')
      .digest();
    this.maxUploadBytes = options.maxUploadBytes;
    this.now = options.now ?? (() => new Date());
  }

  public async issueUpload(input: {
    objectKey: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    expiresInSeconds: number;
  }): Promise<UploadDescriptor> {
    this.resolveObjectPath(input.objectKey, 'issue');
    const metadata = {
      ...input,
      sha256: typeof input.sha256 === 'string' ? input.sha256.toLowerCase() : '',
    };
    this.assertMetadata(metadata);
    this.assertTtl(input.expiresInSeconds);
    const token = this.sign({
      operation: 'upload',
      objectKey: input.objectKey,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.sizeBytes,
      sha256: metadata.sha256,
      expiresAt: this.nowMs() + input.expiresInSeconds * 1_000,
    });
    return {
      objectKey: input.objectKey,
      uploadUrl: this.urlFor(token),
      expiresInSeconds: input.expiresInSeconds,
    };
  }

  public async acceptUpload(token: string, bytes: Buffer): Promise<void> {
    const payload = this.verifyToken(token, 'upload');
    if (!Buffer.isBuffer(bytes)
      || bytes.length !== payload.sizeBytes
      || this.digest(bytes) !== payload.sha256) {
      throw new Error('UPLOAD_INVALID');
    }

    const objectPath = this.resolveObjectPath(payload.objectKey, 'token');
    if (this.activeWrites.has(objectPath)) throw new Error('UPLOAD_INVALID');
    this.activeWrites.add(objectPath);
    const metadataPath = `${objectPath}.json`;
    const temporaryObjectPath = `${objectPath}.tmp-${randomUUID()}`;
    const temporaryMetadataPath = `${metadataPath}.tmp-${randomUUID()}`;
    try {
      await this.ensureSafeParent(objectPath);
      await this.assertRealParentContained(objectPath);
      if (await this.exists(objectPath) || await this.exists(metadataPath)) {
        throw new Error('UPLOAD_INVALID');
      }
      const metadata: ObjectMetadata = {
        mimeType: payload.mimeType,
        sizeBytes: payload.sizeBytes,
        sha256: payload.sha256,
      };
      const storedMetadata: StoredMetadata = {
        ...metadata,
        integrity: this.metadataIntegrity(payload.objectKey, metadata),
      };
      await writeFile(temporaryObjectPath, bytes, { flag: 'wx', mode: 0o600 });
      await writeFile(temporaryMetadataPath, JSON.stringify(storedMetadata), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      await rename(temporaryObjectPath, objectPath);
      try {
        await rename(temporaryMetadataPath, metadataPath);
      } catch (error) {
        await rm(objectPath, { force: true });
        throw error;
      }
    } catch (error) {
      if (error instanceof Error && ['UPLOAD_INVALID', 'FORBIDDEN'].includes(error.message)) {
        throw error;
      }
      throw new Error('UPLOAD_INVALID');
    } finally {
      await Promise.all([
        rm(temporaryObjectPath, { force: true }),
        rm(temporaryMetadataPath, { force: true }),
      ]);
      this.activeWrites.delete(objectPath);
    }
  }

  public async verifyUpload(
    objectKey: string,
    expected: ObjectMetadata,
  ): Promise<boolean> {
    const objectPath = this.resolveObjectPath(objectKey, 'token');
    const metadata = await this.readMetadata(objectPath, objectKey);
    if (!metadata || !this.sameMetadata(metadata, {
      ...expected,
      sha256: expected.sha256.toLowerCase(),
    })) return false;
    return this.contentMatches(objectPath, metadata);
  }

  public async issueReadUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
    const objectPath = this.resolveObjectPath(objectKey, 'token');
    this.assertTtl(expiresInSeconds);
    const metadata = await this.readMetadata(objectPath, objectKey);
    if (!metadata || !await this.contentMatches(objectPath, metadata)) {
      throw new Error('FORBIDDEN');
    }
    return this.urlFor(this.sign({
      operation: 'read',
      objectKey,
      ...metadata,
      expiresAt: this.nowMs() + expiresInSeconds * 1_000,
    }));
  }

  public async readObject(token: string): Promise<LocalPilotObject> {
    const payload = this.verifyToken(token, 'read');
    const objectPath = this.resolveObjectPath(payload.objectKey, 'token');
    const metadata = await this.readMetadata(objectPath, payload.objectKey);
    if (!metadata || !this.sameMetadata(metadata, payload)) throw new Error('FORBIDDEN');
    try {
      const bytes = await this.readBoundedRegularFile(objectPath, metadata.sizeBytes);
      if (bytes.length !== metadata.sizeBytes || this.digest(bytes) !== metadata.sha256) {
        throw new Error('FORBIDDEN');
      }
      return { bytes, mimeType: metadata.mimeType };
    } catch {
      throw new Error('FORBIDDEN');
    }
  }

  private sign(payload: CapabilityPayload): string {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', this.signingKey).update(encoded, 'ascii').digest('base64url');
    return `${encoded}.${signature}`;
  }

  private verifyToken(token: string, operation: Operation): CapabilityPayload {
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
      throw new Error('FORBIDDEN');
    }
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]
      || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) {
      throw new Error('FORBIDDEN');
    }
    const expected = createHmac('sha256', this.signingKey).update(parts[0], 'ascii').digest();
    const actual = Buffer.from(parts[1], 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new Error('FORBIDDEN');
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    } catch {
      throw new Error('FORBIDDEN');
    }
    if (!this.isPayload(decoded)
      || decoded.operation !== operation
      || decoded.expiresAt <= this.nowMs()) {
      throw new Error('FORBIDDEN');
    }
    this.resolveObjectPath(decoded.objectKey, 'token');
    return decoded;
  }

  private isPayload(value: unknown): value is CapabilityPayload {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    if (Object.keys(candidate).sort().join(',')
      !== 'expiresAt,mimeType,objectKey,operation,sha256,sizeBytes') return false;
    return (candidate.operation === 'upload' || candidate.operation === 'read')
      && typeof candidate.objectKey === 'string'
      && typeof candidate.mimeType === 'string'
      && typeof candidate.sizeBytes === 'number'
      && typeof candidate.sha256 === 'string'
      && typeof candidate.expiresAt === 'number'
      && Number.isSafeInteger(candidate.expiresAt)
      && this.metadataIsValid(candidate as ObjectMetadata);
  }

  private resolveObjectPath(objectKey: string, source: 'issue' | 'token'): string {
    const error = source === 'issue' ? 'UPLOAD_INVALID' : 'FORBIDDEN';
    if (typeof objectKey !== 'string'
      || objectKey.length === 0
      || objectKey.length > MAX_OBJECT_KEY_LENGTH
      || objectKey.includes('\\')
      || objectKey.includes('\0')
      || path.isAbsolute(objectKey)) {
      throw new Error(objectKey.includes('..') || path.isAbsolute(objectKey) ? 'FORBIDDEN' : error);
    }
    const segments = objectKey.split('/');
    if (segments.some((segment) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(segment)
      || segment === '.' || segment === '..')) {
      throw new Error(segments.includes('..') ? 'FORBIDDEN' : error);
    }
    if (segments.at(-1)?.toLowerCase().endsWith('.json')) throw new Error(error);

    const resolved = path.resolve(this.rootDir, ...segments);
    const root = `${this.rootDir}${path.sep}`;
    if (!resolved.startsWith(root)) throw new Error('FORBIDDEN');
    const storageId = createHmac('sha256', this.signingKey)
      .update(`object\0${objectKey}`, 'utf8')
      .digest('hex');
    return path.join(this.rootDir, storageId);
  }

  private assertMetadata(metadata: ObjectMetadata): void {
    if (!this.metadataIsValid(metadata)) throw new Error('UPLOAD_INVALID');
  }

  private metadataIsValid(metadata: ObjectMetadata): boolean {
    return ALLOWED_MIME_TYPES.has(metadata.mimeType)
      && Number.isSafeInteger(metadata.sizeBytes)
      && metadata.sizeBytes > 0
      && metadata.sizeBytes <= this.maxUploadBytes
      && /^[a-f0-9]{64}$/.test(metadata.sha256);
  }

  private assertTtl(expiresInSeconds: number): void {
    if (!Number.isSafeInteger(expiresInSeconds)
      || expiresInSeconds <= 0
      || expiresInSeconds > MAX_TOKEN_TTL_SECONDS) {
      throw new Error('UPLOAD_INVALID');
    }
  }

  private async readMetadata(objectPath: string, objectKey: string): Promise<ObjectMetadata | null> {
    try {
      const encoded = await this.readBoundedRegularFile(`${objectPath}.json`, MAX_METADATA_BYTES);
      const parsed: unknown = JSON.parse(encoded.toString('utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
      const candidate = parsed as Record<string, unknown>;
      if (Object.keys(candidate).sort().join(',') !== 'integrity,mimeType,sha256,sizeBytes'
        || typeof candidate.integrity !== 'string') return null;
      const metadata: ObjectMetadata = {
        mimeType: candidate.mimeType as string,
        sizeBytes: candidate.sizeBytes as number,
        sha256: candidate.sha256 as string,
      };
      if (!this.metadataIsValid(metadata)) return null;
      const expected = Buffer.from(this.metadataIntegrity(objectKey, metadata), 'hex');
      const actual = Buffer.from(candidate.integrity, 'hex');
      return actual.length === expected.length && timingSafeEqual(actual, expected) ? metadata : null;
    } catch {
      return null;
    }
  }

  private async contentMatches(objectPath: string, metadata: ObjectMetadata): Promise<boolean> {
    try {
      const bytes = await this.readBoundedRegularFile(objectPath, metadata.sizeBytes);
      return bytes.length === metadata.sizeBytes && this.digest(bytes) === metadata.sha256;
    } catch {
      return false;
    }
  }

  private sameMetadata(left: ObjectMetadata, right: ObjectMetadata): boolean {
    return left.mimeType === right.mimeType
      && left.sizeBytes === right.sizeBytes
      && left.sha256 === right.sha256;
  }

  private digest(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
  }

  private metadataIntegrity(objectKey: string, metadata: ObjectMetadata): string {
    return createHmac('sha256', this.signingKey)
      .update('metadata\0', 'utf8')
      .update(JSON.stringify([
        objectKey,
        metadata.mimeType,
        metadata.sizeBytes,
        metadata.sha256,
      ]), 'utf8')
      .digest('hex');
  }

  private nowMs(): number {
    const value = this.now().getTime();
    if (!Number.isFinite(value)) throw new Error('FORBIDDEN');
    return value;
  }

  private urlFor(token: string): string {
    return `/api/v1/pilot/local-evidence?token=${encodeURIComponent(token)}`;
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async assertRealParentContained(objectPath: string): Promise<void> {
    const [realRoot, realParent] = await Promise.all([
      realpath(this.rootDir),
      realpath(path.dirname(objectPath)),
    ]);
    const root = `${realRoot}${path.sep}`;
    if (realParent !== realRoot && !realParent.startsWith(root)) throw new Error('FORBIDDEN');
  }

  private async ensureSafeParent(objectPath: string): Promise<void> {
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    const rootStats = await lstat(this.rootDir);
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) throw new Error('FORBIDDEN');

    const relativeParent = path.relative(this.rootDir, path.dirname(objectPath));
    let current = this.rootDir;
    for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (error) {
        if (!(typeof error === 'object' && error !== null
          && 'code' in error && error.code === 'EEXIST')) throw error;
      }
      const stats = await lstat(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('FORBIDDEN');
    }
  }

  private async readBoundedRegularFile(filePath: string, maxBytes: number): Promise<Buffer> {
    const rootStats = await lstat(this.rootDir);
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) throw new Error('FORBIDDEN');
    const pathStats = await lstat(filePath);
    if (pathStats.isSymbolicLink() || !pathStats.isFile() || pathStats.size > maxBytes) {
      throw new Error('FORBIDDEN');
    }
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    const handle = await open(filePath, constants.O_RDONLY | noFollow);
    try {
      const [stats, postPathStats, postRootStats, realFile, realRoot] = await Promise.all([
        handle.stat(),
        lstat(filePath),
        lstat(this.rootDir),
        realpath(filePath),
        realpath(this.rootDir),
      ]);
      if (!stats.isFile() || stats.size > maxBytes) throw new Error('FORBIDDEN');
      if (postPathStats.isSymbolicLink()
        || !postPathStats.isFile()
        || postRootStats.isSymbolicLink()
        || !postRootStats.isDirectory()
        || stats.dev !== postPathStats.dev
        || stats.ino !== postPathStats.ino
        || rootStats.dev !== postRootStats.dev
        || rootStats.ino !== postRootStats.ino
        || path.dirname(realFile) !== realRoot) {
        throw new Error('FORBIDDEN');
      }
      const buffer = Buffer.allocUnsafe(stats.size + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead !== stats.size) throw new Error('FORBIDDEN');
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }
}
