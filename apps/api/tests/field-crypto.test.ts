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

  it('requires canonical Base64 and a positive legacy key version', () => {
    const valid = Buffer.alloc(32, 7).toString('base64');
    expect(() => FieldCrypto.fromBase64(`${valid}\n`, 1)).toThrow('32 bytes');
    expect(() => FieldCrypto.fromBase64(valid, 0)).toThrow('key version');
  });

  it('uses authenticated associated data and decrypts prior key versions from a keyring', () => {
    const v1 = Buffer.alloc(32, 8).toString('base64');
    const v2 = Buffer.alloc(32, 9).toString('base64');
    const legacy = FieldCrypto.fromBase64(v1, 1);
    const aad = Buffer.from('petcare/order-message/v1\u0000order\u0000message\u0000OWNER', 'utf8');
    const encrypted = legacy.encrypt('previously encrypted', { associatedData: aad });
    const rotated = FieldCrypto.fromKeyring([[1, v1], [2, v2]], 2);

    expect(rotated.decrypt(encrypted, { associatedData: aad })).toBe('previously encrypted');
    expect(rotated.encrypt('new message', { associatedData: aad }).keyVersion).toBe(2);
    expect(() => rotated.decrypt(encrypted, { associatedData: Buffer.from('wrong') }))
      .toThrow('authentication failed');
    expect(() => rotated.decrypt({ ...encrypted, keyVersion: 99 }, { associatedData: aad }))
      .toThrow('unsupported encryption key version');
  });

  it('rejects malformed, duplicate, and noncanonical keyring entries without revealing key material', () => {
    const valid = Buffer.alloc(32, 10).toString('base64');
    for (const entries of [
      [[1, valid], [1, valid]],
      [[1, `${valid}\n`]],
      [[0, valid]],
    ] satisfies Array<Array<readonly [number, string]>>) {
      expect(() => FieldCrypto.fromKeyring(entries, 1)).toThrow('field encryption keyring is invalid');
    }
  });
});
