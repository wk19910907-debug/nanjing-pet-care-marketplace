import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('enables WeChat login only explicitly, with complete server credentials and pilot sessions', () => {
    const environment = {
      DATABASE_URL: 'postgresql://localhost/test', PILOT_MODE: 'enabled',
      PILOT_AUTH_PEPPER: Buffer.alloc(32, 1).toString('base64'),
      WECHAT_APP_ID: 'wx1234567890abcdef', WECHAT_APP_SECRET: 'a'.repeat(32),
    };
    expect(loadConfig(environment)).not.toHaveProperty('wechatLogin');
    expect(loadConfig({ ...environment, WECHAT_LOGIN_ENABLED: 'true' }).wechatLogin)
      .toEqual({ appId: environment.WECHAT_APP_ID, appSecret: environment.WECHAT_APP_SECRET });
    for (const field of ['WECHAT_APP_ID', 'WECHAT_APP_SECRET', 'PILOT_MODE']) {
      expect(() => loadConfig({ ...environment, WECHAT_LOGIN_ENABLED: 'true', [field]: undefined }))
        .toThrow(field);
    }
    expect(() => loadConfig({ ...environment, WECHAT_LOGIN_ENABLED: 'yes' })).toThrow();
  });

  it('requires a PostgreSQL database URL', () => {
    expect(() => loadConfig({})).toThrow('DATABASE_URL');
    expect(() => loadConfig({ DATABASE_URL: 'sqlite:file.db' })).toThrow('DATABASE_URL');
  });

  it('accepts a PostgreSQL URL and defaults to development', () => {
    expect(loadConfig({
      DATABASE_URL: 'postgresql://petcare:petcare@localhost:54329/petcare',
    })).toEqual({
      nodeEnv: 'development',
      databaseUrl: 'postgresql://petcare:petcare@localhost:54329/petcare',
    });
  });

  it('adds decoded pilot configuration only when explicitly enabled', () => {
    const pepper = Buffer.alloc(32, 7).toString('base64');
    expect(loadConfig({
      DATABASE_URL: 'postgresql://petcare:petcare@localhost:54329/petcare',
      PILOT_MODE: 'enabled',
      PILOT_AUTH_PEPPER: pepper,
    })).toEqual({
      nodeEnv: 'development',
      databaseUrl: 'postgresql://petcare:petcare@localhost:54329/petcare',
      pilot: {
        enabled: true,
        host: '127.0.0.1',
        port: 3000,
        authPepper: Buffer.alloc(32, 7),
        sessionDays: 7,
        inviteHours: 24,
        secureCookies: false,
      },
    });
  });

  it.each([
    [{}, 'PILOT_AUTH_PEPPER'],
    [{ PILOT_AUTH_PEPPER: 'not-base64' }, 'PILOT_AUTH_PEPPER'],
    [{ PILOT_AUTH_PEPPER: Buffer.alloc(31, 1).toString('base64') }, 'PILOT_AUTH_PEPPER'],
    [{ PILOT_AUTH_PEPPER: Buffer.alloc(32, 1).toString('base64'), PILOT_PORT: '0' }, 'PILOT_PORT'],
    [{ PILOT_AUTH_PEPPER: Buffer.alloc(32, 1).toString('base64'), PILOT_PORT: '65536' }, 'PILOT_PORT'],
    [{ PILOT_AUTH_PEPPER: Buffer.alloc(32, 1).toString('base64'), PILOT_SESSION_DAYS: '31' }, 'PILOT_SESSION_DAYS'],
    [{ PILOT_AUTH_PEPPER: Buffer.alloc(32, 1).toString('base64'), PILOT_INVITE_HOURS: '169' }, 'PILOT_INVITE_HOURS'],
  ])('rejects invalid enabled pilot configuration %j', (overrides, field) => {
    expect(() => loadConfig({
      DATABASE_URL: 'postgresql://petcare:petcare@localhost:54329/petcare',
      PILOT_MODE: 'enabled',
      ...overrides,
    })).toThrow(field);
  });

  it('parses every explicit pilot field and enables secure cookies in production', () => {
    const pepper = Buffer.alloc(48, 9).toString('base64');
    const config = loadConfig({
      NODE_ENV: 'production', DATABASE_URL: 'postgresql://db.internal/pilot',
      PILOT_MODE: 'enabled', PILOT_HOST: '0.0.0.0', PILOT_PORT: '43124',
      PILOT_PUBLIC_ORIGIN: 'https://pilot.example.com', PILOT_AUTH_PEPPER: pepper,
      PILOT_SESSION_DAYS: '30', PILOT_INVITE_HOURS: '168',
      PILOT_EVIDENCE_DIR: 'D:\\pilot-evidence',
      PILOT_TRUST_PROXY: '127.0.0.1/32, ::1/128',
      FIELD_ENCRYPTION_KEY_V1: Buffer.alloc(32, 1).toString('base64'),
      PILOT_SHARED_INGRESS_RATE_LIMITING: 'enabled',
      S3_ENDPOINT: 'https://objects.example.com', S3_BUCKET: 'pilot-evidence',
      S3_ACCESS_KEY_ID: 'access-id', S3_SECRET_ACCESS_KEY: 'access-secret',
      S3_REGION: 'auto', S3_FORCE_PATH_STYLE: 'true',
    });
    expect(config.pilot).toEqual({
      enabled: true, host: '0.0.0.0', port: 43124,
      publicOrigin: 'https://pilot.example.com', authPepper: Buffer.alloc(48, 9),
      sessionDays: 30, inviteHours: 168, evidenceDir: 'D:\\pilot-evidence',
      trustedProxies: ['127.0.0.1/32', '::1/128'], secureCookies: true,
      sharedIngressRateLimiting: true,
    });
    expect(config.production).not.toHaveProperty('wechatPay');
    expect(config.production).not.toHaveProperty('wechatNotifications');
    expect(config.production?.objectStorage).toEqual({
      endpoint: 'https://objects.example.com', bucket: 'pilot-evidence',
      accessKeyId: 'access-id', secretAccessKey: 'access-secret',
      region: 'auto', forcePathStyle: true,
    });
  });

  it('parses an explicit active field-encryption keyring and rejects ambiguous or invalid forms', () => {
    const v1 = Buffer.alloc(32, 12).toString('base64');
    const v2 = Buffer.alloc(32, 13).toString('base64');
    const environment = {
      DATABASE_URL: 'postgresql://petcare:petcare@localhost:54329/petcare',
      FIELD_ENCRYPTION_KEYRING: JSON.stringify([{ version: 1, key: v1 }, { version: 2, key: v2 }]),
      FIELD_ENCRYPTION_ACTIVE_VERSION: '2',
    };
    expect(loadConfig(environment).fieldEncryptionKeyring).toEqual({
      activeVersion: 2,
      keys: new Map([[1, v1], [2, v2]]),
    });
    for (const overrides of [
      { FIELD_ENCRYPTION_KEYRING: JSON.stringify([{ version: 1, key: v1 }, { version: 1, key: v2 }]) },
      { FIELD_ENCRYPTION_KEYRING: JSON.stringify([{ version: 1, key: `${v1}\n` }]) },
      { FIELD_ENCRYPTION_KEYRING: JSON.stringify([{ version: 1, key: v1 }]), FIELD_ENCRYPTION_ACTIVE_VERSION: '2' },
      { FIELD_ENCRYPTION_KEYRING: JSON.stringify([{ version: 1, key: v1 }]), FIELD_ENCRYPTION_ACTIVE_VERSION: undefined },
      { FIELD_ENCRYPTION_KEYRING: 'not-json', FIELD_ENCRYPTION_ACTIVE_VERSION: '1' },
      { FIELD_ENCRYPTION_KEYRING: JSON.stringify([{ version: 1, key: v1 }]), FIELD_ENCRYPTION_ACTIVE_VERSION: '1', FIELD_ENCRYPTION_KEY_V1: v1 },
    ]) {
      expect(() => loadConfig({ ...environment, ...overrides })).toThrow(/FIELD_ENCRYPTION_(KEYRING|ACTIVE_VERSION)/);
    }
  });

  it('requires legacy FIELD_ENCRYPTION_KEY_V1 to be exact canonical Base64 for 32 bytes', () => {
    const valid = Buffer.alloc(32, 17).toString('base64');
    const base = { DATABASE_URL: 'postgresql://petcare:petcare@localhost:54329/petcare' };
    expect(loadConfig({ ...base, FIELD_ENCRYPTION_KEY_V1: valid }).fieldEncryptionKey).toBe(valid);
    for (const invalid of [`${valid}\n`, `${valid}A`, Buffer.alloc(31, 17).toString('base64')]) {
      expect(() => loadConfig({ ...base, FIELD_ENCRYPTION_KEY_V1: invalid }))
        .toThrow('FIELD_ENCRYPTION_KEY_V1');
    }
  });

  it('accepts a keyring without legacy v1 configuration in production pilot mode', () => {
    const v1 = Buffer.alloc(32, 14).toString('base64');
    const v2 = Buffer.alloc(32, 15).toString('base64');
    const config = loadConfig({
      NODE_ENV: 'production', DATABASE_URL: 'postgresql://db.internal/pilot', PILOT_MODE: 'enabled',
      PILOT_PUBLIC_ORIGIN: 'https://pilot.example.com', PILOT_SHARED_INGRESS_RATE_LIMITING: 'enabled',
      PILOT_AUTH_PEPPER: Buffer.alloc(32, 16).toString('base64'),
      FIELD_ENCRYPTION_KEYRING: JSON.stringify([{ version: 1, key: v1 }, { version: 2, key: v2 }]),
      FIELD_ENCRYPTION_ACTIVE_VERSION: '2',
      S3_ENDPOINT: 'https://objects.example.com', S3_BUCKET: 'pilot-evidence',
      S3_ACCESS_KEY_ID: 'access-id', S3_SECRET_ACCESS_KEY: 'access-secret', S3_REGION: 'auto',
    });
    expect(config.production?.fieldEncryptionKey).toBeUndefined();
    expect(config.production?.fieldEncryptionKeyring).toEqual({ activeVersion: 2, keys: new Map([[1, v1], [2, v2]]) });
  });

  it.each(['TRUE', '1', 'yes', ''])('rejects malformed S3_FORCE_PATH_STYLE value %j', (value) => {
    expect(() => loadConfig({
      NODE_ENV: 'production', DATABASE_URL: 'postgresql://db.internal/pilot',
      PILOT_MODE: 'enabled', PILOT_PUBLIC_ORIGIN: 'https://pilot.example.com',
      PILOT_AUTH_PEPPER: Buffer.alloc(32, 9).toString('base64'),
      FIELD_ENCRYPTION_KEY_V1: Buffer.alloc(32, 2).toString('base64'),
      S3_ENDPOINT: 'https://objects.example.com', S3_BUCKET: 'pilot-evidence',
      S3_ACCESS_KEY_ID: 'access-id', S3_SECRET_ACCESS_KEY: 'access-secret',
      S3_REGION: 'auto', S3_FORCE_PATH_STYLE: value,
    })).toThrow('S3_FORCE_PATH_STYLE');
  });

  it.each(['true', '*', '0.0.0.0/0', '::/0', '127.0.0.1/33', 'example.com'])
  ('rejects unsafe or malformed trusted proxy value %s', (trustedProxy) => {
    expect(() => loadConfig({
      DATABASE_URL: 'postgresql://petcare:petcare@localhost:54329/petcare',
      PILOT_MODE: 'enabled',
      PILOT_AUTH_PEPPER: Buffer.alloc(32, 1).toString('base64'),
      PILOT_TRUST_PROXY: trustedProxy,
    })).toThrow('PILOT_TRUST_PROXY');
  });
});
