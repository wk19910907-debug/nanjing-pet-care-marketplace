import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('mini-program visible branding', () => {
  it('uses the city-neutral service name in visible page copy', () => {
    for (const path of [
      'app.json',
      'pages/home/index.json',
      'pages/home/index.wxml',
      'pages/owner/order-create/index.wxml',
    ]) {
      expect(readFileSync(path, 'utf8'), path).not.toContain('南京');
    }
  });
});
