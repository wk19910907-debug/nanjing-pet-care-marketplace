import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

describe('formal operating visual system', () => {
  it('defines the trusted-service palette and accessible interaction rules', () => {
    expect(css).toContain('--brand-coral');
    expect(css).toContain('--brand-cream');
    expect(css).toContain('--brand-ink');
    expect(css).toContain('min-height: 44px');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).not.toContain('transform: translateY(-1px)');
  });
});
