import { describe, expect, it } from 'vitest';
import { maskOperationalOrder, navigationForRole } from './access.js';

describe('operator access model', () => {
  it.each([
    ['REVIEWER', ['服务者审核', '审计记录']],
    ['DISPATCHER', ['订单调度', '订单查询', '审计记录']],
    ['SUPPORT', ['订单查询', '投诉退款', '审计记录']],
    ['ADMIN', ['服务者审核', '订单调度', '订单查询', '投诉退款', '指标', '设置', '审计记录']],
  ] as const)('limits %s navigation', (role, labels) => {
    expect(navigationForRole(role).map((item) => item.label)).toEqual(labels);
  });

  it('never exposes access instructions or owner contact in dispatch lists', () => {
    expect(maskOperationalOrder({ id: 'o1', district: '建邺区', serviceZone: '奥体东',
      addressDetail: '2栋301', accessInstructions: '门锁1234', ownerPhone: '13800000000' }))
      .toEqual({ id: 'o1', district: '建邺区', serviceZone: '奥体东', addressDetail: '建邺区·奥体东（详细地址已隐藏）' });
  });
});
