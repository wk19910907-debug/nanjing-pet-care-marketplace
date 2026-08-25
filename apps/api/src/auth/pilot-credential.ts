import { createHmac, randomBytes } from 'node:crypto';

export type PilotCredentialPurpose = 'invite' | 'session';

export function digestPilotCredential(
  pepper: Buffer,
  purpose: PilotCredentialPurpose,
  raw: string,
): string {
  return createHmac('sha256', pepper).update(`${purpose}\0${raw}`, 'utf8').digest('hex');
}

export function createPilotCredential(
  pepper: Buffer,
  purpose: PilotCredentialPurpose,
  random: (size: number) => Buffer = randomBytes,
): { raw: string; digest: string } {
  const raw = random(32).toString('base64url');
  return { raw, digest: digestPilotCredential(pepper, purpose, raw) };
}
