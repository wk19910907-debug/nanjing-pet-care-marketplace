import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Media } from './fulfillment-models.js';

const MAX_BYTES = 20 * 1024 * 1024;
export type SelectedEvidence = { bytes: ArrayBuffer; media: Media };
export type MediaPlatform = {
  chooseMedia(options: { count: number; mediaType: string[]; sourceType: string[];
    success(result: { tempFiles: Array<{ tempFilePath: string; size: number }> }): void;
    fail(error: unknown): void }): void;
  getFileSystemManager(): { readFile(options: { filePath: string;
    success(result: { data: ArrayBuffer | string }): void; fail(error: unknown): void }): void };
};

export function prepareEvidence(bytes: ArrayBuffer): SelectedEvidence {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) throw new Error('MEDIA_TOO_LARGE');
  const data = new Uint8Array(bytes);
  const starts = (signature: number[]) => signature.every((byte, index) => data[index] === byte);
  const mimeType = starts([137, 80, 78, 71, 13, 10, 26, 10]) ? 'image/png'
    : starts([255, 216, 255]) ? 'image/jpeg'
      : data.length >= 12 && starts([82, 73, 70, 70]) && [87, 69, 66, 80].every((byte, index) => data[index + 8] === byte)
        ? 'image/webp' : '';
  if (!mimeType) throw new Error('MEDIA_TYPE_NOT_ALLOWED');
  return { bytes, media: { mimeType, sizeBytes: bytes.byteLength, sha256: bytesToHex(sha256(data)) } };
}

export async function chooseEvidence(platform: MediaPlatform): Promise<SelectedEvidence | null> {
  const selected = await new Promise<{ tempFilePath: string; size: number } | null>((resolve, reject) => {
    platform.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'],
      success: (result) => result.tempFiles[0] ? resolve(result.tempFiles[0]) : resolve(null),
      fail: (error) => {
        const message = error && typeof error === 'object' && 'errMsg' in error ? String(error.errMsg) : '';
        if (/cancel/i.test(message)) resolve(null); else reject(new Error('MEDIA_SELECTION_FAILED'));
      },
    });
  });
  if (!selected) return null;
  if (selected.size < 1 || selected.size > MAX_BYTES) throw new Error('MEDIA_TOO_LARGE');
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => platform.getFileSystemManager().readFile({
    filePath: selected.tempFilePath,
    success: ({ data }) => data instanceof ArrayBuffer ? resolve(data) : reject(new Error('MEDIA_READ_FAILED')),
    fail: () => reject(new Error('MEDIA_READ_FAILED')),
  }));
  return prepareEvidence(bytes);
}
