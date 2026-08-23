import { describe, expect, it } from 'vitest';
import { FieldCrypto } from '../src/adapters/field-crypto.js';

describe('FieldCrypto', () => {
  it('encrypts and authenticates UTF-8 values', () => {
    const crypto = FieldCrypto.fromBase64(Buffer.alloc(32, 7).toString('base64'), 1);
    const encrypted = crypto.encrypt('门锁说明：钥匙在物业');
    expect(encrypted.ciphertext.toString('utf8')).not.toContain('钥匙在物业');
    expect(crypto.decrypt(encrypted)).toBe('门锁说明：钥匙在物业');
    expect(encrypted.keyVersion).toBe(1);
  });

  it('rejects keys that are not exactly 32 bytes', () => {
    expect(() => FieldCrypto.fromBase64(Buffer.alloc(31).toString('base64'), 1)).toThrow(
      '32 bytes',
    );
  });
});
