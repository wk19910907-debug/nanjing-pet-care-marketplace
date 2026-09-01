import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { resolvePilotServerOverrides } from '../src/server.js';

const environment = {
  NODE_ENV: 'production', DATABASE_URL: 'postgresql://db.internal/pilot',
  PILOT_MODE: 'enabled', PILOT_PUBLIC_ORIGIN: 'https://pilot.example.com',
  PILOT_AUTH_PEPPER: Buffer.alloc(32, 9).toString('base64'),
  FIELD_ENCRYPTION_KEY_V1: Buffer.alloc(32, 2).toString('base64'),
  S3_ENDPOINT: 'https://objects.example.com', S3_BUCKET: 'pilot-evidence',
  S3_ACCESS_KEY_ID: 'pilot-access-id', S3_SECRET_ACCESS_KEY: 'pilot-storage-secret',
  S3_REGION: 'auto', S3_FORCE_PATH_STYLE: 'true',
};

describe('resolvePilotServerOverrides', () => {
  it('constructs the production S3 signer and preserves explicit overrides', () => {
    const signer = { probe: vi.fn(), presignPut: vi.fn(), presignGet: vi.fn(), head: vi.fn() };
    const factory = vi.fn(() => signer);
    const config = loadConfig(environment);
    const resolved = resolvePilotServerOverrides(config, { staticDir: 'dist' }, factory);

    expect(factory).toHaveBeenCalledWith({
      endpoint: 'https://objects.example.com', bucket: 'pilot-evidence',
      accessKeyId: 'pilot-access-id', secretAccessKey: 'pilot-storage-secret',
      region: 'auto', forcePathStyle: true,
    });
    expect(resolved).toEqual({ staticDir: 'dist', s3Signer: signer });

    const explicit = { probe: vi.fn(), presignPut: vi.fn(), presignGet: vi.fn(), head: vi.fn() };
    expect(resolvePilotServerOverrides(config, { s3Signer: explicit }, factory).s3Signer).toBe(explicit);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('does not construct production storage in development', () => {
    const factory = vi.fn();
    const config = loadConfig({
      DATABASE_URL: 'postgresql://db.internal/pilot', PILOT_MODE: 'enabled',
      PILOT_AUTH_PEPPER: Buffer.alloc(32, 9).toString('base64'),
    });
    expect(resolvePilotServerOverrides(config, { staticDir: 'dist' }, factory)).toEqual({ staticDir: 'dist' });
    expect(factory).not.toHaveBeenCalled();
  });
});
