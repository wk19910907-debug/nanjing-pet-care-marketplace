import { describe, expect, it } from 'vitest';
import { digestPilotCredential } from '../src/auth/pilot-credential.js';
import {
  digestOwnerRecoveryToken,
  generateOwnerRecoveryToken,
  matchesOwnerRecoveryToken,
  ownerRecoveryLookupPrefix,
} from '../src/auth/owner-recovery-credential.js';

describe('owner recovery credentials', () => {
  it('creates canonical 256-bit Base64URL recovery tokens with a separate digest domain', () => {
    const token = generateOwnerRecoveryToken();
    const pepper = Buffer.alloc(32, 7);

    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(digestOwnerRecoveryToken(pepper, token)).toMatch(/^[a-f0-9]{64}$/);
    expect(digestOwnerRecoveryToken(pepper, token))
      .not.toBe(digestPilotCredential(pepper, 'session', token));
    expect(ownerRecoveryLookupPrefix(token)).toBe(token.slice(0, 12));
    expect(matchesOwnerRecoveryToken(pepper, token, digestOwnerRecoveryToken(pepper, token)))
      .toBe(true);
  });
});
