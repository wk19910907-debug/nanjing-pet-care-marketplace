import { describe, expect, it } from 'vitest';
import {
  ownerActions,
  presentOrderTimeline,
  presentQuoteBreakdown,
  sanitizeCandidateOrder,
} from '../presenters/order-presenter.js';

describe('owner order presenters', () => {
  it('presents a transparent server quote in yuan without floating-point drift', () => {
    expect(presentQuoteBreakdown({
      baseFen: 3200, distanceFen: 500, extraPetFen: 700,
      durationFen: 0, holidayFen: 0, totalFen: 4400, currency: 'CNY',
    })).toEqual([
      { label: '基础服务', value: '¥32.00' },
      { label: '超距费用', value: '¥5.00' },
      { label: '多宠费用', value: '¥7.00' },
      { label: '合计', value: '¥44.00', emphasized: true },
    ]);
  });

  it('builds the owner timeline from the current order status', () => {
    const timeline = presentOrderTimeline('IN_SERVICE');
    expect(timeline.map((item) => item.label)).toEqual(['已付款', '已匹配服务人员', '服务进行中', '待提交报告', '已完成']);
    expect(timeline.map((item) => item.state)).toEqual(['done', 'done', 'current', 'pending', 'pending']);
  });

  it('shows the real API quote fields including duration and distance charges', () => {
    expect(presentQuoteBreakdown({ baseFen: 3200, durationFen: 700, distanceFen: 500, extraPetFen: 700,
      holidayFen: 0, totalFen: 5100, currency: 'CNY' })).toEqual([
      { label: '基础服务', value: '¥32.00' }, { label: '加时费用', value: '¥7.00' },
      { label: '超距费用', value: '¥5.00' }, { label: '多宠费用', value: '¥7.00' },
      { label: '合计', value: '¥51.00', emphasized: true },
    ]);
  });

  it('shows confirmation and complaint only after a report, and cancellation before service', () => {
    expect(ownerActions('PENDING_CONFIRMATION')).toEqual({ canCancel: false, canConfirm: true, canDispute: true });
    expect(ownerActions('PENDING_DISPATCH')).toEqual({ canCancel: true, canConfirm: false, canDispute: false });
  });

  it('removes full address, access instructions, contact and sensitive notes from candidate views', () => {
    expect(sanitizeCandidateOrder({
      id: 'order-1', district: '建邺区', serviceZone: '奥体东',
      addressDetail: '江东中路 100 号 2 栋 301', accessInstructions: '门锁密码 1234',
      ownerPhone: '13800000000', sensitiveNotes: '怕陌生男性',
    })).toEqual({ id: 'order-1', district: '建邺区', serviceZone: '奥体东' });
  });
});
