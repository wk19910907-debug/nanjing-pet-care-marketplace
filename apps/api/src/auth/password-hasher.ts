import argon2 from 'argon2';

const MINIMUM_PASSWORD_LENGTH = 12;
const MAXIMUM_PASSWORD_LENGTH = 128;

export class PasswordHasher {
  async hash(password: string): Promise<string> {
    if (password.length < MINIMUM_PASSWORD_LENGTH || password.length > MAXIMUM_PASSWORD_LENGTH) {
      throw new Error('PASSWORD_INVALID');
    }
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    if (password.length < 1 || password.length > MAXIMUM_PASSWORD_LENGTH) return false;
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}
