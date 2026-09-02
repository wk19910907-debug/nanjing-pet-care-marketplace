import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const RECOVERY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function assertRecoveryToken(token: string): void {
  if (!RECOVERY_TOKEN_PATTERN.test(token)) throw new Error('RECOVERY_INVALID');
}

export function generateOwnerRecoveryToken(): string {
  return randomBytes(32).toString('base64url');
}

export function ownerRecoveryLookupPrefix(token: string): string {
  assertRecoveryToken(token);
  return token.slice(0, 12);
}

export function digestOwnerRecoveryToken(pepper: Buffer, token: string): string {
  assertRecoveryToken(token);
  return createHmac('sha256', pepper)
    .update(`owner-recovery-v1\0${token}`, 'utf8')
    .digest('hex');
}

export function matchesOwnerRecoveryToken(
  pepper: Buffer,
  token: string,
  storedHash: string,
): boolean {
  const actual = Buffer.from(digestOwnerRecoveryToken(pepper, token), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
