import { describe, expect, it } from 'vitest';
import { PasswordHasher } from '../src/auth/password-hasher.js';

describe('PasswordHasher', () => {
  it('uses the fixed Argon2id policy and rejects invalid lengths', async () => {
    const hasher = new PasswordHasher();
    const hash = await hasher.hash('correct horse battery staple');

    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(hasher.verify(hash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(hasher.hash('short')).rejects.toThrow('PASSWORD_INVALID');
  });
});
