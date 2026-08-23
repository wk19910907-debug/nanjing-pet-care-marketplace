import { describe, expect, it } from 'vitest';
import { definePilotMetrics } from './metrics.js';

describe('pilot metric definitions', () => {
  it('states numerator, denominator, timezone and date window for every metric', () => {
    const metrics = definePilotMetrics({ from: '2026-08-01', to: '2026-08-31', timezone: 'Asia/Shanghai' });
    expect(metrics.map((item) => item.key)).toEqual([
      'median_first_accept_seconds', 'dispatch_success_rate', 'completion_rate', 'on_time_rate',
      'complaint_rate', 'refund_rate', 'repeat_owner_rate', 'support_minutes_per_order',
      'platform_gross_fen', 'provider_payout_fen',
    ]);
    expect(metrics.every((item) => item.numerator && item.denominator && item.timezone === 'Asia/Shanghai'
      && item.window === '2026-08-01—2026-08-31')).toBe(true);
  });
});
