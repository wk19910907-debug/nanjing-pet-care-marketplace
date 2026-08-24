import { describe, expect, it } from 'vitest';
import { calculateSettlement } from './settlement.js';

describe('calculateSettlement', () => {
  it('uses integer fen and assigns rounding remainder to the provider', () => {
    expect(calculateSettlement(3901, 2000)).toEqual({
      grossFen: 3901, commissionFen: 780, providerFen: 3121, commissionBps: 2000,
    });
  });

  it.each([1499, 2501])('rejects commission outside pilot range: %i', (commissionBps) => {
    expect(() => calculateSettlement(3900, commissionBps)).toThrow('INVALID_COMMISSION_BPS');
  });
});
