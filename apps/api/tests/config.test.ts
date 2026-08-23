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
});
