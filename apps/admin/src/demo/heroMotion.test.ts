import { describe, expect, it } from 'vitest';
import { calculateHeroParallax } from './heroMotion.js';

describe('calculateHeroParallax', () => {
  const bounds = { left: 100, top: 50, width: 400, height: 200 };
  it('keeps the center still', () => expect(calculateHeroParallax(300, 150, bounds)).toEqual({ x: 0, y: 0 }));
  it('clamps both edges to eight pixels', () => {
    expect(calculateHeroParallax(-100, -100, bounds)).toEqual({ x: -8, y: -8 });
    expect(calculateHeroParallax(900, 900, bounds)).toEqual({ x: 8, y: 8 });
  });
  it('fails closed for zero-sized bounds', () => {
    expect(calculateHeroParallax(1, 1, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});
