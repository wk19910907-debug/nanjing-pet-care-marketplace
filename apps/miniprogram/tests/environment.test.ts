import { describe, expect, it } from 'vitest';
import { resolveApiBaseUrl } from '../services/environment.js';

describe('mini program API environment', () => {
  it('requires a public HTTPS URL in trial and release builds', () => {
    expect(resolveApiBaseUrl({ environment: 'release', productionBaseUrl: 'https://api.example.cn/' }))
      .toBe('https://api.example.cn');
    expect(() => resolveApiBaseUrl({ environment: 'trial', productionBaseUrl: 'http://api.example.cn' }))
      .toThrow('PRODUCTION_API_MUST_USE_HTTPS');
    expect(() => resolveApiBaseUrl({ environment: 'release', productionBaseUrl: 'https://127.0.0.1:3000' }))
      .toThrow('PRODUCTION_API_MUST_BE_PUBLIC');
  });

  it('allows an explicit local HTTP override only in development', () => {
    expect(resolveApiBaseUrl({
      environment: 'develop', productionBaseUrl: 'https://api.example.cn',
      developmentBaseUrl: 'http://127.0.0.1:3000/',
    })).toBe('http://127.0.0.1:3000');
    expect(() => resolveApiBaseUrl({
      environment: 'develop', productionBaseUrl: 'https://api.example.cn',
      developmentBaseUrl: 'http://untrusted.example.cn',
    })).toThrow('DEVELOPMENT_HTTP_API_MUST_BE_LOCAL');
  });
});
