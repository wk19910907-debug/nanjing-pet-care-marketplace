import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type EncryptedField = {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: number;
};

export type FieldCryptoOptions = { associatedData?: Uint8Array };

export class FieldCrypto {
  private constructor(
    private readonly keys: ReadonlyMap<number, Buffer>,
    private readonly activeKeyVersion: number,
  ) {}

  public static fromBase64(value: string, keyVersion: number): FieldCrypto {
    if (!Number.isSafeInteger(keyVersion) || keyVersion < 1 || keyVersion > 2_147_483_647) {
      throw new Error('field encryption key version must be a positive integer');
    }
    if (!isCanonicalBase64(value)) {
      throw new Error('field encryption key must decode to exactly 32 bytes');
    }
    const key = Buffer.from(value, 'base64');
    if (key.length !== 32) {
      throw new Error('field encryption key must decode to exactly 32 bytes');
    }
    return new FieldCrypto(new Map([[keyVersion, key]]), keyVersion);
  }

  public static fromKeyring(
    entries: Iterable<readonly [number, string]>,
    activeKeyVersion: number,
  ): FieldCrypto {
    const keys = new Map<number, Buffer>();
    try {
      for (const [version, encoded] of entries) {
        if (!Number.isSafeInteger(version) || version < 1 || version > 2_147_483_647 || keys.has(version)) {
          throw new Error('invalid version');
        }
        if (!isCanonicalBase64(encoded)) throw new Error('invalid key');
        const key = Buffer.from(encoded, 'base64');
        if (key.byteLength !== 32) throw new Error('invalid key length');
        keys.set(version, key);
      }
      if (keys.size === 0 || !keys.has(activeKeyVersion)) throw new Error('missing active key');
    } catch {
      throw new Error('field encryption keyring is invalid');
    }
    return new FieldCrypto(keys, activeKeyVersion);
  }

  public encrypt(plaintext: string, options: FieldCryptoOptions = {}): EncryptedField {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.activeKeyVersion)!, nonce);
    if (options.associatedData) cipher.setAAD(Buffer.from(options.associatedData));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return { ciphertext, nonce, authTag: cipher.getAuthTag(), keyVersion: this.activeKeyVersion };
  }

  public decrypt(field: EncryptedField, options: FieldCryptoOptions = {}): string {
    const key = this.keys.get(field.keyVersion);
    if (!key) {
      throw new Error(`unsupported encryption key version ${field.keyVersion}`);
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, field.nonce);
      if (options.associatedData) decipher.setAAD(Buffer.from(options.associatedData));
      decipher.setAuthTag(field.authTag);
      return Buffer.concat([decipher.update(field.ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('field authentication failed');
    }
  }

  public encryptPacked(plaintext: string, options: FieldCryptoOptions = {}): { packed: Buffer; keyVersion: number } {
    const field = this.encrypt(plaintext, options);
    return {
      packed: Buffer.concat([field.nonce, field.authTag, field.ciphertext]),
      keyVersion: field.keyVersion,
    };
  }

  public decryptPacked(packed: Uint8Array, keyVersion: number, options: FieldCryptoOptions = {}): string {
    const value = Buffer.from(packed);
    if (value.length < 28) {
      throw new Error('encrypted field is malformed');
    }
    return this.decrypt({
      nonce: value.subarray(0, 12),
      authTag: value.subarray(12, 28),
      ciphertext: value.subarray(28),
      keyVersion,
    }, options);
  }
}

function isCanonicalBase64(value: string): boolean {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
}
