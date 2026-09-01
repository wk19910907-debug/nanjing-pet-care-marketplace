import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const assets = [
  ['premium-care-hero.avif', 350_000],
  ['premium-care-hero.webp', 350_000],
  ['cat-care-card.avif', 180_000],
  ['cat-care-card.webp', 180_000],
  ['dog-walk-card.avif', 180_000],
  ['dog-walk-card.webp', 180_000],
] as const;

describe('premium customer media', () => {
  it.each(assets)('%s is repository-owned and within its transfer budget', (name, limit) => {
    const file = new URL(`../assets/${name}`, import.meta.url);
    const bytes = statSync(file).size;
    expect(bytes).toBeGreaterThan(8_000);
    expect(bytes).toBeLessThan(limit);
  });
});
