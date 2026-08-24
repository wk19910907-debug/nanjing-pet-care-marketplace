import { describe, expect, it } from 'vitest';
import { getPublicQuote, PUBLIC_DISTRICTS } from './publicQuote.js';

describe('public quote', () => {
  it('uses the existing demo prices', () => {
    expect(getPublicQuote('CAT_FEEDING')).toEqual({ priceFen: 3200, priceLabel: '¥32' });
    expect(getPublicQuote('DOG_WALKING')).toEqual({ priceFen: 3700, priceLabel: '¥37' });
  });

  it('offers only the four declared experience districts', () => {
    expect(PUBLIC_DISTRICTS).toEqual(['建邺区', '鼓楼区', '玄武区', '秦淮区']);
  });
});
