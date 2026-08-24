import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type EncryptedField = {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: number;
};

export class FieldCrypto {
  private constructor(
    private readonly key: Buffer,
    private readonly keyVersion: number,
  ) {}

  public static fromBase64(value: string, keyVersion: number): FieldCrypto {
    const key = Buffer.from(value, 'base64');
    if (key.length !== 32) {
      throw new Error('field encryption key must decode to exactly 32 bytes');
    }
    return new FieldCrypto(key, keyVersion);
  }

  public encrypt(plaintext: string): EncryptedField {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return { ciphertext, nonce, authTag: cipher.getAuthTag(), keyVersion: this.keyVersion };
  }

  public decrypt(field: EncryptedField): string {
    if (field.keyVersion !== this.keyVersion) {
      throw new Error(`unsupported encryption key version ${field.keyVersion}`);
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, field.nonce);
    decipher.setAuthTag(field.authTag);
    return Buffer.concat([decipher.update(field.ciphertext), decipher.final()]).toString('utf8');
  }

  public encryptPacked(plaintext: string): { packed: Buffer; keyVersion: number } {
    const field = this.encrypt(plaintext);
    return {
      packed: Buffer.concat([field.nonce, field.authTag, field.ciphertext]),
      keyVersion: field.keyVersion,
    };
  }

  public decryptPacked(packed: Uint8Array, keyVersion: number): string {
    const value = Buffer.from(packed);
    if (value.length < 28) {
      throw new Error('encrypted field is malformed');
    }
    return this.decrypt({
      nonce: value.subarray(0, 12),
      authTag: value.subarray(12, 28),
      ciphertext: value.subarray(28),
      keyVersion,
    });
  }
}
