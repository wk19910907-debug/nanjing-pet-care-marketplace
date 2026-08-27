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
  readdir,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type {
  EvidenceQuotaScope,
  ObjectStorage,
  UploadDescriptor,
  UploadRequest,
} from './object-storage.js';

const TOKEN_PURPOSE = 'pilot-local-evidence-v1';
const MAX_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const MAX_OBJECT_KEY_LENGTH = 500;
const MAX_TOKEN_LENGTH = 8_192;
const MAX_METADATA_BYTES = 2_048;
const MAX_RESERVATION_BYTES = 2_048;
const OBJECT_NAME = /^[a-f0-9]{64}$/;
const METADATA_NAME = /^([a-f0-9]{64})\.json$/;
const RESERVATION_NAME = /^([a-f0-9]{64})\.reservation\.json$/;
const TEMPORARY_NAME = /^[a-f0-9]{64}(?:\.json)?\.tmp-[a-f0-9-]{36}$/;
const ROOT_LEASE_NAME = '.pilot-storage.lease';
const ROOT_LEASE_MAX_BYTES = 512;
const ROOT_LEASE_WAIT_MS = 5_000;
const ROOT_LEASE_RETRY_MS = 10;
const ROOT_MUTATION_TAILS = new Map<string, Promise<void>>();
const ACTIVE_ROOT_LEASES = new Set<string>();
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
]);
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ']);

export type LocalPilotStorageQuotas = {
  maxObjectsPerOrder: number;
  maxObjectsPerActor: number;
  maxTotalObjects: number;
  maxTotalBytes: number;
};

export const DEFAULT_LOCAL_PILOT_STORAGE_QUOTAS: Readonly<LocalPilotStorageQuotas> = {
  maxObjectsPerOrder: 12,
  maxObjectsPerActor: 60,
  maxTotalObjects: 1_000,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
};

type Operation = 'upload' | 'read';
type ObjectMetadata = {
  mimeType: string;
  sizeBytes: number;
  sha256: string;
};
type CapabilityPayload = ObjectMetadata & {
  operation: Operation;
  objectKey: string;
  expiresAt: number;
};
type StoredObjectRecord = ObjectMetadata & EvidenceQuotaScope & {
  kind: 'object';
  objectKey: string;
  integrity: string;
};
type ReservationRecord = ObjectMetadata & EvidenceQuotaScope & {
  kind: 'reservation';
  objectKey: string;
  expiresAt: number;
  integrity: string;
};
type QuotaEntry = EvidenceQuotaScope & { sizeBytes: number };
type RootIdentity = { dev: number; ino: number; birthtimeMs: number };
type RootLease = { id: string; pid: number; createdAt: number };

export type LocalPilotObjectStorageOptions = {
  rootDir: string;
  signingSecret: Buffer;
  maxUploadBytes: number;
  quotas?: LocalPilotStorageQuotas;
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
  private readonly quotas: LocalPilotStorageQuotas;
  private readonly now: () => Date;
  private initialization?: Promise<void>;
  private rootIdentity?: RootIdentity;

  public constructor(options: LocalPilotObjectStorageOptions) {
    if (!path.isAbsolute(options.rootDir)) throw new Error('PILOT_EVIDENCE_DIR_INVALID');
    if (options.signingSecret.length < 32) throw new Error('PILOT_EVIDENCE_SECRET_INVALID');
    if (!Number.isSafeInteger(options.maxUploadBytes) || options.maxUploadBytes <= 0) {
      throw new Error('PILOT_EVIDENCE_SIZE_INVALID');
    }
    this.assertQuotas(options.quotas ?? DEFAULT_LOCAL_PILOT_STORAGE_QUOTAS);
    this.rootDir = path.resolve(options.rootDir);
    this.signingKey = createHmac('sha256', options.signingSecret)
      .update(TOKEN_PURPOSE, 'utf8')
      .digest();
    this.maxUploadBytes = options.maxUploadBytes;
    this.quotas = { ...(options.quotas ?? DEFAULT_LOCAL_PILOT_STORAGE_QUOTAS) };
    this.now = options.now ?? (() => new Date());
  }

  public initialize(): Promise<void> {
    this.initialization ??= this.withMutation(async () => {
      await this.scavengeUnlocked();
      await this.assertRootIdentity();
    });
    return this.initialization;
  }

  public async issueUpload(input: UploadRequest): Promise<UploadDescriptor> {
    const objectPath = this.resolveObjectPath(input.objectKey, 'issue');
    const metadata = {
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256: typeof input.sha256 === 'string' ? input.sha256.toLowerCase() : '',
    };
    this.assertMetadata(metadata);
    this.assertTtl(input.expiresInSeconds);
    const scope = this.resolveQuotaScope(input.objectKey, input.quotaScope);
    const payload: CapabilityPayload = {
      operation: 'upload',
      objectKey: input.objectKey,
      ...metadata,
      expiresAt: this.nowMs() + input.expiresInSeconds * 1_000,
    };
    try {
      await this.initialize();
      await this.withMutation(async () => {
        await this.assertRootIdentity();
        const entries = await this.scavengeUnlocked();
        if (await this.exists(objectPath)
          || await this.exists(`${objectPath}.json`)
          || await this.exists(this.reservationPath(objectPath))) {
          throw new Error('UPLOAD_INVALID');
        }
        this.assertWithinQuota(entries, { ...scope, sizeBytes: metadata.sizeBytes });
        const reservation: ReservationRecord = {
          kind: 'reservation',
          objectKey: input.objectKey,
          ...scope,
          ...metadata,
          expiresAt: payload.expiresAt,
          integrity: '',
        };
        reservation.integrity = this.recordIntegrity(reservation);
        await this.writeExclusive(this.reservationPath(objectPath), JSON.stringify(reservation));
        await this.assertRootIdentity();
      });
    } catch (error) {
      this.rethrowStorageError(error, ['UPLOAD_INVALID', 'FORBIDDEN', 'EVIDENCE_QUOTA_EXCEEDED']);
    }
    return {
      objectKey: input.objectKey,
      uploadUrl: this.urlFor(this.sign(payload)),
      expiresInSeconds: input.expiresInSeconds,
    };
  }

  public async acceptUpload(token: string, bytes: Buffer): Promise<void> {
    const payload = this.verifyToken(token, 'upload');
    const objectPath = this.resolveObjectPath(payload.objectKey, 'token');
    await this.initialize();
    await this.withMutation(async () => {
      await this.assertRootIdentity();
      await this.scavengeUnlocked();
      const reservationPath = this.reservationPath(objectPath);
      const reservation = await this.readReservation(reservationPath, payload.objectKey);
      if (!reservation
        || reservation.expiresAt !== payload.expiresAt
        || !this.sameMetadata(reservation, payload)) {
        throw new Error('UPLOAD_INVALID');
      }
      if (!Buffer.isBuffer(bytes)
        || bytes.length !== payload.sizeBytes
        || this.digest(bytes) !== payload.sha256
        || !this.matchesDeclaredMime(payload.mimeType, bytes)) {
        await this.safeUnlink(reservationPath);
        throw new Error('UPLOAD_INVALID');
      }

      const metadataPath = `${objectPath}.json`;
      const temporaryObjectPath = `${objectPath}.tmp-${randomUUID()}`;
      const temporaryMetadataPath = `${metadataPath}.tmp-${randomUUID()}`;
      const stored: StoredObjectRecord = {
        kind: 'object',
        objectKey: payload.objectKey,
        actorId: reservation.actorId,
        orderId: reservation.orderId,
        mimeType: payload.mimeType,
        sizeBytes: payload.sizeBytes,
        sha256: payload.sha256,
        integrity: '',
      };
      stored.integrity = this.recordIntegrity(stored);
      try {
        if (await this.exists(objectPath) || await this.exists(metadataPath)) {
          throw new Error('UPLOAD_INVALID');
        }
        await this.writeExclusive(temporaryObjectPath, bytes);
        await this.writeExclusive(temporaryMetadataPath, JSON.stringify(stored));
        await this.assertRootIdentity();
        await rename(temporaryObjectPath, objectPath);
        await this.assertRootIdentity();
        try {
          await rename(temporaryMetadataPath, metadataPath);
        } catch (error) {
          await this.safeUnlink(objectPath);
          throw error;
        }
        await this.safeUnlink(reservationPath);
        await this.assertRootIdentity();
      } catch (error) {
        await this.safeUnlinkIfRootUnchanged(temporaryObjectPath);
        await this.safeUnlinkIfRootUnchanged(temporaryMetadataPath);
        if (error instanceof Error && ['UPLOAD_INVALID', 'FORBIDDEN'].includes(error.message)) {
          throw error;
        }
        throw new Error('UPLOAD_INVALID');
      }
    });
  }

  public async verifyUpload(objectKey: string, expected: ObjectMetadata): Promise<boolean> {
    await this.initialize();
    const objectPath = this.resolveObjectPath(objectKey, 'token');
    const stored = await this.readStoredObject(`${objectPath}.json`, objectKey);
    if (!stored || !this.sameMetadata(stored, {
      ...expected,
      sha256: typeof expected.sha256 === 'string' ? expected.sha256.toLowerCase() : '',
    })) return false;
    return this.contentMatches(objectPath, stored);
  }

  public async issueReadUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
    await this.initialize();
    const objectPath = this.resolveObjectPath(objectKey, 'token');
    this.assertTtl(expiresInSeconds);
    const stored = await this.readStoredObject(`${objectPath}.json`, objectKey);
    if (!stored || !await this.contentMatches(objectPath, stored)) throw new Error('FORBIDDEN');
    return this.urlFor(this.sign({
      operation: 'read',
      objectKey,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
      expiresAt: this.nowMs() + expiresInSeconds * 1_000,
    }));
  }

  public async readObject(token: string): Promise<LocalPilotObject> {
    const payload = this.verifyToken(token, 'read');
    await this.initialize();
    const objectPath = this.resolveObjectPath(payload.objectKey, 'token');
    const stored = await this.readStoredObject(`${objectPath}.json`, payload.objectKey);
    if (!stored || !this.sameMetadata(stored, payload)) throw new Error('FORBIDDEN');
    try {
      const bytes = await this.readBoundedRegularFile(objectPath, stored.sizeBytes);
      if (bytes.length !== stored.sizeBytes
        || this.digest(bytes) !== stored.sha256
        || !this.matchesDeclaredMime(stored.mimeType, bytes)) throw new Error('FORBIDDEN');
      return { bytes, mimeType: stored.mimeType };
    } catch {
      throw new Error('FORBIDDEN');
    }
  }

  private async scavengeUnlocked(): Promise<QuotaEntry[]> {
    await this.assertRootIdentity();
    let names = await readdir(this.rootDir, { withFileTypes: true });
    for (const entry of names) {
      if (TEMPORARY_NAME.test(entry.name) && !entry.isDirectory()) {
        await this.safeUnlink(path.join(this.rootDir, entry.name));
      }
    }
    names = await readdir(this.rootDir, { withFileTypes: true });
    const regularNames = new Set(names.filter((entry) => entry.isFile()).map((entry) => entry.name));
    const quotaEntries: QuotaEntry[] = [];

    for (const name of [...regularNames]) {
      const match = name.match(RESERVATION_NAME);
      if (!match) continue;
      const base = match[1]!;
      const reservationPath = path.join(this.rootDir, name);
      const reservation = await this.readReservation(reservationPath);
      const completedPair = regularNames.has(base) && regularNames.has(`${base}.json`);
      if (!reservation || reservation.expiresAt <= this.nowMs() || completedPair) {
        await this.safeUnlink(reservationPath);
        regularNames.delete(name);
      } else {
        quotaEntries.push(reservation);
      }
    }

    const baseNames = new Set<string>();
    for (const name of regularNames) {
      if (OBJECT_NAME.test(name)) baseNames.add(name);
      const metadata = name.match(METADATA_NAME);
      if (metadata) baseNames.add(metadata[1]!);
    }
    for (const base of baseNames) {
      const objectPath = path.join(this.rootDir, base);
      const metadataPath = `${objectPath}.json`;
      if (!regularNames.has(base) || !regularNames.has(`${base}.json`)) {
        if (regularNames.has(base)) await this.safeUnlink(objectPath);
        if (regularNames.has(`${base}.json`)) await this.safeUnlink(metadataPath);
        continue;
      }
      const stored = await this.readStoredObject(metadataPath);
      const expectedPath = stored ? this.resolveObjectPath(stored.objectKey, 'token') : undefined;
      if (!stored || expectedPath !== objectPath || !await this.contentMatches(objectPath, stored)) {
        await this.safeUnlink(objectPath);
        await this.safeUnlink(metadataPath);
        continue;
      }
      quotaEntries.push(stored);
    }
    await this.assertRootIdentity();
    return quotaEntries;
  }

  private matchesDeclaredMime(mimeType: string, bytes: Buffer): boolean {
    if (mimeType === 'image/png') {
      return bytes.length >= 16
        && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        && bytes.subarray(12, 16).toString('ascii') === 'IHDR';
    }
    if (mimeType === 'image/jpeg') {
      const firstMarker = bytes[3];
      return bytes.length >= 8
        && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        && firstMarker !== undefined
        && firstMarker >= 0xc0
        && firstMarker !== 0xff
        && firstMarker !== 0xd8
        && firstMarker !== 0xd9
        && !(firstMarker >= 0xd0 && firstMarker <= 0xd7)
        && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
    }
    if (mimeType === 'image/webp') {
      if (bytes.length < 16
        || bytes.subarray(0, 4).toString('ascii') !== 'RIFF'
        || bytes.readUInt32LE(4) !== bytes.length - 8
        || bytes.subarray(8, 12).toString('ascii') !== 'WEBP') return false;
      return ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.subarray(12, 16).toString('ascii'));
    }
    if (mimeType === 'video/mp4' || mimeType === 'video/quicktime') {
      if (bytes.length < 16 || bytes.subarray(4, 8).toString('ascii') !== 'ftyp') return false;
      const boxSize = bytes.readUInt32BE(0);
      if (boxSize < 16 || boxSize > bytes.length || boxSize % 4 !== 0) return false;
      const brands = [bytes.subarray(8, 12).toString('ascii')];
      for (let offset = 16; offset + 4 <= boxSize; offset += 4) {
        brands.push(bytes.subarray(offset, offset + 4).toString('ascii'));
      }
      return mimeType === 'video/quicktime'
        ? brands.includes('qt  ')
        : brands.some((brand) => MP4_BRANDS.has(brand)) && !brands.includes('qt  ');
    }
    return false;
  }

  private assertWithinQuota(entries: QuotaEntry[], addition: QuotaEntry): void {
    const orderCount = entries.filter((entry) => entry.orderId === addition.orderId).length;
    const actorCount = entries.filter((entry) => entry.actorId === addition.actorId).length;
    const totalBytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
    if (orderCount + 1 > this.quotas.maxObjectsPerOrder
      || actorCount + 1 > this.quotas.maxObjectsPerActor
      || entries.length + 1 > this.quotas.maxTotalObjects
      || totalBytes + addition.sizeBytes > this.quotas.maxTotalBytes) {
      throw new Error('EVIDENCE_QUOTA_EXCEEDED');
    }
  }

  private resolveQuotaScope(objectKey: string, supplied?: EvidenceQuotaScope): EvidenceQuotaScope {
    const orderId = objectKey.split('/')[1];
    const scope = supplied ?? { actorId: 'local-legacy', orderId: orderId ?? '' };
    if (!orderId
      || scope.orderId !== orderId
      || !/^[A-Za-z0-9_-]{1,128}$/.test(scope.actorId)
      || !/^[A-Za-z0-9_-]{1,128}$/.test(scope.orderId)) throw new Error('UPLOAD_INVALID');
    return scope;
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
      || decoded.expiresAt <= this.nowMs()) throw new Error('FORBIDDEN');
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
    if (segments.length < 3
      || segments[0] !== 'orders'
      || segments.some((segment) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(segment)
        || segment === '.' || segment === '..')) {
      throw new Error(segments.includes('..') ? 'FORBIDDEN' : error);
    }
    if (segments.at(-1)?.toLowerCase().endsWith('.json')) throw new Error(error);
    const resolved = path.resolve(this.rootDir, ...segments);
    if (!resolved.startsWith(`${this.rootDir}${path.sep}`)) throw new Error('FORBIDDEN');
    const storageId = createHmac('sha256', this.signingKey)
      .update(`object\0${objectKey}`, 'utf8')
      .digest('hex');
    return path.join(this.rootDir, storageId);
  }

  private async readStoredObject(filePath: string, objectKey?: string): Promise<StoredObjectRecord | null> {
    const parsed = await this.readRecord(filePath, MAX_METADATA_BYTES);
    if (!parsed || parsed.kind !== 'object' || (objectKey && parsed.objectKey !== objectKey)) return null;
    return this.validStoredObject(parsed) ? parsed : null;
  }

  private async readReservation(filePath: string, objectKey?: string): Promise<ReservationRecord | null> {
    const parsed = await this.readRecord(filePath, MAX_RESERVATION_BYTES);
    if (!parsed || parsed.kind !== 'reservation' || (objectKey && parsed.objectKey !== objectKey)) return null;
    return this.validReservation(parsed) ? parsed : null;
  }

  private async readRecord(filePath: string, maxBytes: number): Promise<Record<string, unknown> | null> {
    try {
      const encoded = await this.readBoundedRegularFile(filePath, maxBytes);
      const parsed: unknown = JSON.parse(encoded.toString('utf8'));
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }

  private validStoredObject(value: Record<string, unknown>): value is StoredObjectRecord {
    if (Object.keys(value).sort().join(',')
      !== 'actorId,integrity,kind,mimeType,objectKey,orderId,sha256,sizeBytes') return false;
    return this.validCommonRecord(value) && this.recordIntegrity(value as StoredObjectRecord) === value.integrity;
  }

  private validReservation(value: Record<string, unknown>): value is ReservationRecord {
    if (Object.keys(value).sort().join(',')
      !== 'actorId,expiresAt,integrity,kind,mimeType,objectKey,orderId,sha256,sizeBytes') return false;
    return this.validCommonRecord(value)
      && typeof value.expiresAt === 'number'
      && Number.isSafeInteger(value.expiresAt)
      && this.recordIntegrity(value as ReservationRecord) === value.integrity;
  }

  private validCommonRecord(value: Record<string, unknown>): boolean {
    if (typeof value.objectKey !== 'string'
      || typeof value.actorId !== 'string'
      || typeof value.orderId !== 'string'
      || typeof value.integrity !== 'string'
      || !this.metadataIsValid(value as ObjectMetadata)) return false;
    try {
      return this.resolveQuotaScope(value.objectKey, {
        actorId: value.actorId,
        orderId: value.orderId,
      }).orderId === value.orderId;
    } catch {
      return false;
    }
  }

  private recordIntegrity(record: Omit<StoredObjectRecord, 'integrity'> | StoredObjectRecord
    | Omit<ReservationRecord, 'integrity'> | ReservationRecord): string {
    return createHmac('sha256', this.signingKey)
      .update('record\0', 'utf8')
      .update(JSON.stringify([
        record.kind,
        record.objectKey,
        record.actorId,
        record.orderId,
        record.mimeType,
        record.sizeBytes,
        record.sha256,
        'expiresAt' in record ? record.expiresAt : null,
      ]), 'utf8')
      .digest('hex');
  }

  private async contentMatches(objectPath: string, metadata: ObjectMetadata): Promise<boolean> {
    try {
      const bytes = await this.readBoundedRegularFile(objectPath, metadata.sizeBytes);
      return bytes.length === metadata.sizeBytes
        && this.digest(bytes) === metadata.sha256
        && this.matchesDeclaredMime(metadata.mimeType, bytes);
    } catch {
      return false;
    }
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

  private sameMetadata(left: ObjectMetadata, right: ObjectMetadata): boolean {
    return left.mimeType === right.mimeType
      && left.sizeBytes === right.sizeBytes
      && left.sha256 === right.sha256;
  }

  private assertTtl(expiresInSeconds: number): void {
    if (!Number.isSafeInteger(expiresInSeconds)
      || expiresInSeconds <= 0
      || expiresInSeconds > MAX_TOKEN_TTL_SECONDS) throw new Error('UPLOAD_INVALID');
  }

  private assertQuotas(quotas: LocalPilotStorageQuotas): void {
    if (Object.values(quotas).some((value) => !Number.isSafeInteger(value) || value <= 0)) {
      throw new Error('PILOT_EVIDENCE_QUOTA_INVALID');
    }
  }

  private digest(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
  }

  private nowMs(): number {
    const value = this.now().getTime();
    if (!Number.isFinite(value)) throw new Error('FORBIDDEN');
    return value;
  }

  private urlFor(token: string): string {
    return `/api/v1/pilot/local-evidence?token=${encodeURIComponent(token)}`;
  }

  private reservationPath(objectPath: string): string {
    return `${objectPath}.reservation.json`;
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async prepareRoot(): Promise<void> {
    const parsed = path.parse(this.rootDir);
    let current = parsed.root;
    for (const segment of this.rootDir.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      try {
        const stats = await lstat(current);
        if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('FORBIDDEN');
      } catch (error) {
        if (!this.isCode(error, 'ENOENT')) throw error;
        await mkdir(current, { mode: 0o700 });
        const stats = await lstat(current);
        if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('FORBIDDEN');
      }
    }
    await this.assertRootComponentsSafe();
  }

  private async assertRootComponentsSafe(): Promise<void> {
    const parsed = path.parse(this.rootDir);
    let current = parsed.root;
    for (const segment of this.rootDir.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      const stats = await lstat(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('FORBIDDEN');
    }
  }

  private async currentRootIdentity(): Promise<RootIdentity> {
    const stats = await lstat(this.rootDir);
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('FORBIDDEN');
    return { dev: stats.dev, ino: stats.ino, birthtimeMs: stats.birthtimeMs };
  }

  private async assertRootIdentity(): Promise<void> {
    if (!this.rootIdentity) throw new Error('FORBIDDEN');
    await this.assertRootComponentsSafe();
    const current = await this.currentRootIdentity();
    if (current.dev !== this.rootIdentity.dev
      || current.ino !== this.rootIdentity.ino
      || current.birthtimeMs !== this.rootIdentity.birthtimeMs) throw new Error('FORBIDDEN');
  }

  private async writeExclusive(filePath: string, contents: string | Buffer): Promise<void> {
    await this.assertDirectRootChild(filePath);
    await writeFile(filePath, contents, {
      ...(typeof contents === 'string' ? { encoding: 'utf8' as const } : {}),
      flag: 'wx',
      mode: 0o600,
    });
    await this.assertRootIdentity();
  }

  private async safeUnlink(filePath: string): Promise<void> {
    await this.assertDirectRootChild(filePath);
    try {
      const stats = await lstat(filePath);
      if (stats.isDirectory()) throw new Error('FORBIDDEN');
      await unlink(filePath);
    } catch (error) {
      if (!this.isCode(error, 'ENOENT')) throw error;
    }
    await this.assertRootIdentity();
  }

  private async safeUnlinkIfRootUnchanged(filePath: string): Promise<void> {
    try {
      await this.assertRootIdentity();
      await this.safeUnlink(filePath);
    } catch {
      // Never follow a cleanup path after the configured root identity changes.
    }
  }

  private async assertDirectRootChild(filePath: string): Promise<void> {
    await this.assertRootIdentity();
    if (path.dirname(path.resolve(filePath)) !== this.rootDir) throw new Error('FORBIDDEN');
  }

  private async readBoundedRegularFile(filePath: string, maxBytes: number): Promise<Buffer> {
    await this.assertDirectRootChild(filePath);
    const pathStats = await lstat(filePath);
    if (pathStats.isSymbolicLink() || !pathStats.isFile() || pathStats.size > maxBytes) {
      throw new Error('FORBIDDEN');
    }
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    const handle = await open(filePath, constants.O_RDONLY | noFollow);
    try {
      const [stats, postPathStats, realFile, realRoot] = await Promise.all([
        handle.stat(),
        lstat(filePath),
        realpath(filePath),
        realpath(this.rootDir),
      ]);
      await this.assertRootIdentity();
      if (!stats.isFile()
        || stats.size > maxBytes
        || postPathStats.isSymbolicLink()
        || !postPathStats.isFile()
        || stats.dev !== postPathStats.dev
        || stats.ino !== postPathStats.ino
        || path.dirname(realFile) !== realRoot) throw new Error('FORBIDDEN');
      const buffer = Buffer.allocUnsafe(stats.size + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead !== stats.size) throw new Error('FORBIDDEN');
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  private async withMutation<T>(operation: () => Promise<T>): Promise<T> {
    const rootKey = process.platform === 'win32' ? this.rootDir.toLowerCase() : this.rootDir;
    const previous = ROOT_MUTATION_TAILS.get(rootKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    ROOT_MUTATION_TAILS.set(rootKey, current);
    await previous;
    let lease: RootLease | undefined;
    try {
      await this.prepareRoot();
      const currentIdentity = await this.currentRootIdentity();
      if (!this.rootIdentity) this.rootIdentity = currentIdentity;
      await this.assertRootIdentity();
      lease = await this.acquireRootLease();
      return await operation();
    } finally {
      if (lease) await this.releaseRootLease(lease);
      release();
      if (ROOT_MUTATION_TAILS.get(rootKey) === current) ROOT_MUTATION_TAILS.delete(rootKey);
    }
  }

  private async acquireRootLease(): Promise<RootLease> {
    const leasePath = path.join(this.rootDir, ROOT_LEASE_NAME);
    const deadline = Date.now() + ROOT_LEASE_WAIT_MS;
    for (;;) {
      const lease: RootLease = { id: randomUUID(), pid: process.pid, createdAt: Date.now() };
      try {
        await this.assertDirectRootChild(leasePath);
        const handle = await open(leasePath, 'wx', 0o600);
        try {
          await handle.writeFile(JSON.stringify(lease), { encoding: 'utf8' });
        } finally {
          await handle.close();
        }
        ACTIVE_ROOT_LEASES.add(lease.id);
        await this.assertRootIdentity();
        return lease;
      } catch (error) {
        if (!this.isCode(error, 'EEXIST')) throw error;
        if (await this.removeStaleRootLease(leasePath)) continue;
        if (Date.now() >= deadline) throw new Error('EVIDENCE_STORAGE_UNAVAILABLE');
        await new Promise<void>((resolve) => { setTimeout(resolve, ROOT_LEASE_RETRY_MS); });
      }
    }
  }

  private async removeStaleRootLease(leasePath: string): Promise<boolean> {
    let existing: RootLease | undefined;
    try {
      const parsed: unknown = JSON.parse((await this.readBoundedRegularFile(
        leasePath,
        ROOT_LEASE_MAX_BYTES,
      )).toString('utf8'));
      if (this.isRootLease(parsed)) existing = parsed;
    } catch {
      // A partially written lease is removable after its owner has had time to finish.
    }
    if (existing && ACTIVE_ROOT_LEASES.has(existing.id)) return false;
    if (existing && this.processIsAlive(existing.pid)) return false;
    const stats = await lstat(leasePath);
    if (!existing && Date.now() - stats.mtimeMs < ROOT_LEASE_WAIT_MS) return false;
    await this.safeUnlink(leasePath);
    return true;
  }

  private async releaseRootLease(lease: RootLease): Promise<void> {
    ACTIVE_ROOT_LEASES.delete(lease.id);
    const leasePath = path.join(this.rootDir, ROOT_LEASE_NAME);
    try {
      const parsed: unknown = JSON.parse((await this.readBoundedRegularFile(
        leasePath,
        ROOT_LEASE_MAX_BYTES,
      )).toString('utf8'));
      if (this.isRootLease(parsed) && parsed.id === lease.id) await this.safeUnlink(leasePath);
    } catch {
      // Do not perform path-based cleanup if the root or lease changed underneath us.
    }
  }

  private isRootLease(value: unknown): value is RootLease {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    return Object.keys(candidate).sort().join(',') === 'createdAt,id,pid'
      && typeof candidate.id === 'string'
      && /^[a-f0-9-]{36}$/.test(candidate.id)
      && typeof candidate.pid === 'number'
      && Number.isSafeInteger(candidate.pid)
      && candidate.pid > 0
      && typeof candidate.createdAt === 'number'
      && Number.isSafeInteger(candidate.createdAt);
  }

  private processIsAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return this.isCode(error, 'EPERM');
    }
  }

  private rethrowStorageError(error: unknown, safeMessages: string[]): never {
    if (error instanceof Error && safeMessages.includes(error.message)) throw error;
    throw new Error('EVIDENCE_STORAGE_UNAVAILABLE');
  }

  private isCode(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null
      && 'code' in error && error.code === code;
  }
}
