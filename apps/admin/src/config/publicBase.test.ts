import { describe, expect, it } from 'vitest';
import { resolvePublicBase } from './publicBase.js';

describe('resolvePublicBase', () => {
  it('keeps local development at the site root', () => {
    expect(resolvePublicBase()).toBe('/');
    expect(resolvePublicBase('   ')).toBe('/');
  });

  it('accepts the GitHub Pages repository path', () => {
    expect(resolvePublicBase(' /nanjing-pet-care-marketplace/ ')).toBe(
      '/nanjing-pet-care-marketplace/',
    );
  });

  it.each(['nanjing-pet-care-marketplace/', '/nanjing-pet-care-marketplace'])(
    'rejects an unsafe base path: %s',
    (value) => {
      expect(() => resolvePublicBase(value)).toThrow(
        'VITE_PUBLIC_BASE must start and end with "/"',
      );
    },
  );
});
