import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
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
      FIELD_ENCRYPTION_KEY_V1: Buffer.alloc(32, 1).toString('base64'),
      S3_ENDPOINT: 'https://objects.example.com', S3_BUCKET: 'pilot-evidence',
      S3_ACCESS_KEY_ID: 'access-id', S3_SECRET_ACCESS_KEY: 'access-secret',
    });
    expect(config.pilot).toEqual({
      enabled: true, host: '0.0.0.0', port: 43124,
      publicOrigin: 'https://pilot.example.com', authPepper: Buffer.alloc(48, 9),
      sessionDays: 30, inviteHours: 168, evidenceDir: 'D:\\pilot-evidence', secureCookies: true,
    });
    expect(config.production).not.toHaveProperty('wechatPay');
    expect(config.production).not.toHaveProperty('wechatNotifications');
  });
});
