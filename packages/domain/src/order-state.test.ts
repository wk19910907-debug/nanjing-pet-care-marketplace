import { describe, expect, it } from 'vitest';
import { transitionOrder } from './order-state.js';

describe('transitionOrder', () => {
  it.each([
    ['PENDING_PAYMENT', 'PAYMENT_VERIFIED', 'PENDING_DISPATCH'],
    ['PENDING_DISPATCH', 'PROVIDER_ASSIGNED', 'PENDING_SERVICE'],
    ['PENDING_SERVICE', 'CHECKED_IN', 'IN_SERVICE'],
    ['IN_SERVICE', 'REPORT_SUBMITTED', 'PENDING_CONFIRMATION'],
    ['PENDING_CONFIRMATION', 'OWNER_CONFIRMED', 'COMPLETED'],
    ['PENDING_CONFIRMATION', 'AUTO_CONFIRMED', 'COMPLETED'],
  ] as const)('moves %s with %s to %s', (current, command, expected) => {
    expect(transitionOrder(current, command)).toBe(expected);
  });

  it('supports cancellation, dispatch failure, dispute and refund paths', () => {
    expect(transitionOrder('PENDING_PAYMENT', 'CANCEL')).toBe('CANCELLED');
    expect(transitionOrder('PENDING_DISPATCH', 'DISPATCH_EXHAUSTED')).toBe('DISPATCH_FAILED');
    expect(transitionOrder('PENDING_CONFIRMATION', 'OPEN_DISPUTE')).toBe('DISPUTED');
    expect(transitionOrder('DISPUTED', 'REQUEST_REFUND')).toBe('REFUND_PENDING');
    expect(transitionOrder('REFUND_PENDING', 'REFUND_SUCCEEDED')).toBe('REFUNDED');
  });

  it('rejects illegal transitions with the stable error code', () => {
    expect(() => transitionOrder('PENDING_PAYMENT', 'CHECKED_IN')).toThrow(
      'INVALID_ORDER_TRANSITION',
    );
  });
});
