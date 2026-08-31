import { describe, expect, it, vi } from 'vitest';
import { prepareEvidence, chooseEvidence } from '../services/evidence.js';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
describe('native evidence media', () => {
  it('hashes selected bytes and infers MIME from content rather than file extension', () => {
    expect(prepareEvidence(png.buffer)).toEqual({ bytes: png.buffer, media: {
      mimeType: 'image/png', sizeBytes: 8,
      sha256: '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6',
    } });
  });
  it.each([new ArrayBuffer(0), new ArrayBuffer(20 * 1024 * 1024 + 1), new Uint8Array([1, 2, 3]).buffer])(
    'rejects empty, oversized or unsupported content', (bytes) => expect(() => prepareEvidence(bytes)).toThrow(),
  );
  it('cancellation does not read or upload a file', async () => {
    const readFile = vi.fn();
    await expect(chooseEvidence({
      chooseMedia: ({ fail }) => fail({ errMsg: 'chooseMedia:fail cancel' }),
      getFileSystemManager: () => ({ readFile }),
    })).resolves.toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });
  it('reads the chosen file as binary without an encoding', async () => {
    const readFile = vi.fn((options) => options.success({ data: png.buffer }));
    const result = await chooseEvidence({
      chooseMedia: ({ success }) => success({ tempFiles: [{ tempFilePath: 'wxfile://photo', size: 8 }] }),
      getFileSystemManager: () => ({ readFile }),
    });
    expect(result?.media.sizeBytes).toBe(8);
    expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ filePath: 'wxfile://photo' }));
    expect(readFile.mock.calls[0]![0]).not.toHaveProperty('encoding');
  });
});
