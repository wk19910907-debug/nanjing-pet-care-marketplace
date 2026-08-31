import URL from 'core-js-pure/actual/url/index.js';
import { OrderStatusSchema } from '@pet/contracts';

export type Media = { mimeType: string; sizeBytes: number; sha256: string };
export type UploadCapability = { objectKey: string; uploadUrl: string; expiresInSeconds: number;
  uploadHeaders?: { 'x-amz-checksum-sha256': string } };
export type ServiceOrder = { id: string; serviceType: 'CAT_FEEDING' | 'DOG_WALKING'; status: string;
  durationMinutes: number; evidence: Array<{ id: string }> };

function invalid(): never { throw new Error('INVALID_SERVICE_RESPONSE'); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 500): string {
  if (typeof value !== 'string' || !value.length || value.length > max) invalid();
  return value;
}
export function uploadUrl(value: string, baseUrl: string): string {
  if (/[\\\s\u0000-\u001f\u007f]/.test(value)) invalid();
  const local = /^\/(?!\/)/.test(value);
  if (local && /[%#]/.test(value)) invalid();
  const parsed = new URL(value, baseUrl);
  if (parsed.username || parsed.password || parsed.hash) invalid();
  if (local) {
    if (parsed.origin !== baseUrl || value !== `${parsed.pathname}${parsed.search}`) invalid();
  } else if (parsed.protocol !== 'https:' || parsed.href !== value) invalid();
  return parsed.href;
}
export function parseUpload(value: unknown, baseUrl: string): UploadCapability {
  const item = record(value);
  const url = text(item.uploadUrl, 2048);
  uploadUrl(url, baseUrl);
  if (!Number.isInteger(item.expiresInSeconds) || Number(item.expiresInSeconds) < 1 || Number(item.expiresInSeconds) > 3600) invalid();
  let headers: UploadCapability['uploadHeaders'];
  if (item.uploadHeaders !== undefined) {
    const input = record(item.uploadHeaders);
    const checksum = text(input['x-amz-checksum-sha256'], 44);
    if (Object.keys(input).length !== 1 || !/^[A-Za-z0-9+/]{43}=$/.test(checksum)) invalid();
    headers = { 'x-amz-checksum-sha256': checksum };
  }
  return { objectKey: text(item.objectKey), uploadUrl: url, expiresInSeconds: Number(item.expiresInSeconds),
    ...(headers ? { uploadHeaders: headers } : {}) };
}
export function parseServiceOrder(value: unknown, expectedId: string): ServiceOrder {
  const item = record(value);
  if (item.id !== expectedId || !['CAT_FEEDING', 'DOG_WALKING'].includes(String(item.serviceType))
    || !OrderStatusSchema.safeParse(item.status).success
    || !Number.isInteger(item.durationMinutes) || Number(item.durationMinutes) <= 0 || !Array.isArray(item.evidence)) invalid();
  return { id: expectedId, serviceType: item.serviceType as ServiceOrder['serviceType'], status: String(item.status),
    durationMinutes: Number(item.durationMinutes), evidence: item.evidence.map((entry) => ({ id: text(record(entry).id, 128) })) };
}
