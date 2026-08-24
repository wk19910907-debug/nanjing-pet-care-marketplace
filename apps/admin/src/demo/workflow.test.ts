import { describe, expect, it } from 'vitest';
import {
  approveProviderApplication,
  assignOrder,
  confirmOrder,
  createInitialState,
  createOrder,
  eligibleProvidersForOrder,
  loadDemoState,
  saveDemoState,
  startService,
  submitProviderApplication,
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

const application = {
  name: '小林',
  district: '秦淮区',
  services: ['DOG_WALKING'] as const,
  experience: '有两年养犬经验，熟悉牵引和基础清洁。',
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

  it('keeps pending applicants out of matching until one-time approval', () => {
    let state = submitProviderApplication(createInitialState(), application);
    expect(state.providerApplications[0]).toMatchObject({ status: 'PENDING' });
    expect(state.providers.map((item) => item.name)).not.toContain('小林');

    state = approveProviderApplication(state, state.providerApplications[0]!.id);
    expect(state.providerApplications[0]).toMatchObject({ status: 'APPROVED' });
    expect(state.providers.at(-1)).toMatchObject({ name: '小林', district: '秦淮区', verified: true });
    expect(() => approveProviderApplication(state, state.providerApplications[0]!.id)).toThrow('申请已完成审核');
  });

  it('gives each approved application a stable unique provider ID', () => {
    let state = submitProviderApplication(createInitialState(), application);
    state = submitProviderApplication(state, {
      ...application,
      name: '小周',
      district: '玄武区',
    });

    state = approveProviderApplication(state, state.providerApplications[0]!.id);
    state = approveProviderApplication(state, state.providerApplications[1]!.id);

    expect(state.providers.slice(-2).map((item) => item.id)).toEqual([
      'provider-application-1',
      'provider-application-2',
    ]);
  });

  it('filters matching candidates by verified status, service and district', () => {
    let state = submitProviderApplication(createInitialState(), application);
    const orderState = createOrder(state, { ...draft, district: '秦淮区', serviceType: 'DOG_WALKING' });
    const order = orderState.orders.at(-1)!;

    expect(eligibleProvidersForOrder(orderState, order)).toEqual([]);
    state = approveProviderApplication(orderState, orderState.providerApplications[0]!.id);
    expect(eligibleProvidersForOrder(state, state.orders.at(-1)!).map((item) => item.name)).toEqual(['小林']);
    expect(() => assignOrder(state, order.id, 'provider-wang')).toThrow('服务人员不在订单服务区域');
  });

  it('requires every provider application field and at least one supported service', () => {
    expect(() => submitProviderApplication(createInitialState(), { ...application, name: '  ' })).toThrow('请填写姓名');
    expect(() => submitProviderApplication(createInitialState(), { ...application, district: '  ' })).toThrow('请填写服务区域');
    expect(() => submitProviderApplication(createInitialState(), { ...application, experience: '  ' })).toThrow('请填写服务经验');
    expect(() => submitProviderApplication(createInitialState(), { ...application, services: [] })).toThrow('请选择至少一项服务');
    expect(() => submitProviderApplication(createInitialState(), { ...application, services: ['BIRD_SITTING' as never] })).toThrow('服务类型无效');
    expect(() => submitProviderApplication(createInitialState(), { ...application, district: '雨花台区' })).toThrow('服务区域无效');
  });

  it('rejects duplicate provider name and district combinations after trimming', () => {
    const state = submitProviderApplication(createInitialState(), application);

    expect(() => submitProviderApplication(state, { ...application, name: ' 小林 ', district: ' 秦淮区 ' }))
      .toThrow('该服务人员已提交申请');
    expect(() => submitProviderApplication(createInitialState(), {
      ...application,
      name: ' 王小宁 ',
      district: ' 建邺区 ',
    })).toThrow('该服务人员已存在');
  });

  it('normalizes legacy saved states without provider applications', () => {
    const values = new Map<string, string>();
    const storage: DemoStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    const state = createOrder(createInitialState(), draft);
    const { providerApplications: _providerApplications, ...legacyState } = state;

    values.set('nanjing-pet-care-demo-v1', JSON.stringify(legacyState));
    expect(loadDemoState(storage)).toMatchObject({ ...state, providerApplications: [] });
  });
});
