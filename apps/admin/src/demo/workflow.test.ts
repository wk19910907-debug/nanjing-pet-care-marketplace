import { describe, expect, it } from 'vitest';
import {
  assignOrder,
  confirmOrder,
  createInitialState,
  createOrder,
  loadDemoState,
  saveDemoState,
  startService,
  submitReport,
  type DemoStorage,
  type OrderDraft,
} from './workflow.js';

const draft: OrderDraft = {
  serviceType: 'CAT_FEEDING',
  petName: '团子',
  district: '建邺区',
  address: '测试小区 1 栋',
  scheduledAt: '2026-08-24T19:00',
  notes: '胆子较小，请轻声开门。',
};

describe('local demo workflow', () => {
  it('moves a new order through the complete managed service loop', () => {
    let state = createOrder(createInitialState(), draft);
    const orderId = state.orders.at(-1)!.id;

    expect(state.orders.at(-1)).toMatchObject({ status: 'WAITING_MATCH', priceFen: 3200 });
    state = assignOrder(state, orderId, 'provider-wang');
    expect(state.orders.at(-1)!.status).toBe('WAITING_SERVICE');
    state = startService(state, orderId);
    expect(state.orders.at(-1)!.status).toBe('IN_SERVICE');
    state = submitReport(state, orderId, {
      fedAndWatered: true,
      areaCleaned: true,
      notes: '团子进食正常，饮水和猫砂均已处理。',
    });
    expect(state.orders.at(-1)!.status).toBe('WAITING_CONFIRMATION');
    state = confirmOrder(state, orderId);

    expect(state.orders.at(-1)!.status).toBe('COMPLETED');
    expect(state.audit.map((item) => item.action)).toEqual([
      'ORDER_CREATED', 'ORDER_ASSIGNED', 'SERVICE_STARTED', 'REPORT_SUBMITTED', 'ORDER_CONFIRMED',
    ]);
  });

  it('rejects skipped transitions and incomplete reports', () => {
    const created = createOrder(createInitialState(), draft);
    const orderId = created.orders.at(-1)!.id;

    expect(() => startService(created, orderId)).toThrow('订单尚未匹配服务人员');
    const started = startService(assignOrder(created, orderId, 'provider-wang'), orderId);
    expect(() => submitReport(started, orderId, {
      fedAndWatered: true,
      areaCleaned: false,
      notes: '已喂食',
    })).toThrow('请完成全部服务清单');
  });

  it('persists state and falls back safely when saved JSON is damaged', () => {
    const values = new Map<string, string>();
    const storage: DemoStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    const state = createOrder(createInitialState(), draft);

    saveDemoState(storage, state);
    expect(loadDemoState(storage)).toEqual(state);
    values.set('nanjing-pet-care-demo-v1', '{not-json');
    expect(loadDemoState(storage).orders).toEqual([]);
  });
});
