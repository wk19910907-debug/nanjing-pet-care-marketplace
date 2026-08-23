import type { OrderStatus } from '@pet/contracts';

type Quote = {
  baseFen: number;
  distanceSurchargeFen: number;
  extraPetFen: number;
  holidaySurchargeFen: number;
  totalFen: number;
};

const yuan = (fen: number) => `¥${(fen / 100).toFixed(2)}`;

export function presentQuoteBreakdown(quote: Quote) {
  const rows = [
    { label: '基础服务', fen: quote.baseFen },
    { label: '超距费用', fen: quote.distanceSurchargeFen },
    { label: '多宠费用', fen: quote.extraPetFen },
    { label: '节假日费用', fen: quote.holidaySurchargeFen },
  ].filter((row) => row.fen > 0).map((row) => ({ label: row.label, value: yuan(row.fen) }));
  return [...rows, { label: '合计', value: yuan(quote.totalFen), emphasized: true as const }];
}

const TIMELINE = [
  { label: '已付款', reached: ['PENDING_DISPATCH', 'PENDING_SERVICE', 'IN_SERVICE', 'PENDING_CONFIRMATION', 'COMPLETED'] },
  { label: '已匹配服务人员', reached: ['PENDING_SERVICE', 'IN_SERVICE', 'PENDING_CONFIRMATION', 'COMPLETED'] },
  { label: '服务进行中', reached: ['IN_SERVICE', 'PENDING_CONFIRMATION', 'COMPLETED'] },
  { label: '待提交报告', reached: ['PENDING_CONFIRMATION', 'COMPLETED'] },
  { label: '已完成', reached: ['COMPLETED'] },
] as const;

export function presentOrderTimeline(status: OrderStatus) {
  const currentIndex = TIMELINE.findIndex((item) => item.reached[0] === status);
  const fallbackIndex = TIMELINE.reduce((last, item, index) => item.reached.includes(status as never) ? index : last, -1);
  const active = currentIndex >= 0 ? currentIndex : fallbackIndex;
  return TIMELINE.map((item, index) => ({
    label: item.label,
    state: index < active ? 'done' as const : index === active ? 'current' as const : 'pending' as const,
  }));
}

export function ownerActions(status: OrderStatus) {
  return {
    canCancel: status === 'PENDING_PAYMENT' || status === 'PENDING_DISPATCH' || status === 'PENDING_SERVICE',
    canConfirm: status === 'PENDING_CONFIRMATION',
    canDispute: status === 'PENDING_CONFIRMATION' || status === 'COMPLETED',
  };
}

export function sanitizeCandidateOrder<T extends {
  addressDetail?: unknown; accessInstructions?: unknown; ownerPhone?: unknown; sensitiveNotes?: unknown;
}>(order: T): Omit<T, 'addressDetail' | 'accessInstructions' | 'ownerPhone' | 'sensitiveNotes'> {
  const { addressDetail: _address, accessInstructions: _access, ownerPhone: _phone,
    sensitiveNotes: _notes, ...safe } = order;
  return safe;
}
