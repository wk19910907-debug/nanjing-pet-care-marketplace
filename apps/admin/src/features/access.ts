export type OperatorRole = 'REVIEWER' | 'DISPATCHER' | 'SUPPORT' | 'ADMIN';
const ITEMS = {
  providers: { label: '服务者审核', path: '/providers' }, dispatch: { label: '订单调度', path: '/dispatch' },
  orders: { label: '订单查询', path: '/orders' }, disputes: { label: '投诉退款', path: '/disputes' },
  metrics: { label: '指标', path: '/metrics' }, settings: { label: '设置', path: '/settings' },
  audit: { label: '审计记录', path: '/audit' },
} as const;

export function navigationForRole(role: OperatorRole) {
  if (role === 'REVIEWER') return [ITEMS.providers, ITEMS.audit];
  if (role === 'DISPATCHER') return [ITEMS.dispatch, ITEMS.orders, ITEMS.audit];
  if (role === 'SUPPORT') return [ITEMS.orders, ITEMS.disputes, ITEMS.audit];
  return [ITEMS.providers, ITEMS.dispatch, ITEMS.orders, ITEMS.disputes,
    ITEMS.metrics, ITEMS.settings, ITEMS.audit];
}

export function maskOperationalOrder<T extends {
  district: string; serviceZone: string; addressDetail?: unknown; accessInstructions?: unknown; ownerPhone?: unknown;
}>(order: T) {
  const { accessInstructions: _access, ownerPhone: _phone, addressDetail: _detail, ...safe } = order;
  return { ...safe, addressDetail: `${order.district}·${order.serviceZone}（详细地址已隐藏）` };
}
