import { describe, expect, it } from 'vitest';
import {
  approveProviderApplication,
  assignOrder,
  confirmOrder,
  createInitialState,
  createOrder,
  eligibleProvidersForOrder,
  loadDemoState,
  preferredProviderId,
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

const completeReport = {
  fedAndWatered: true,
  areaCleaned: true,
  notes: '团子进食正常，饮水和猫砂均已处理。',
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
    state = startService(state, orderId, 'provider-wang');
    expect(state.orders.at(-1)!.status).toBe('IN_SERVICE');
    state = submitReport(state, orderId, 'provider-wang', completeReport);
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

    expect(() => startService(created, orderId, 'provider-wang')).toThrow('订单尚未匹配服务人员');
    const started = startService(assignOrder(created, orderId, 'provider-wang'), orderId, 'provider-wang');
    expect(() => submitReport(started, orderId, 'provider-wang', {
      fedAndWatered: true,
      areaCleaned: false,
      notes: '已喂食',
    })).toThrow('请完成全部服务清单');
  });

  it('selects an explicit verified provider before an active-task fallback', () => {
    let state = createOrder(createInitialState(), draft);
    state = assignOrder(state, state.orders[0]!.id, 'provider-wang');
    expect(preferredProviderId(state, 'provider-chen')).toBe('provider-chen');
  });

  it('selects the provider on the newest active order and safely falls back', () => {
    let state = createOrder(createInitialState(), draft);
    state = assignOrder(state, state.orders[0]!.id, 'provider-wang');
    state = createOrder(state, { ...draft, district: '鼓楼区' });
    state = assignOrder(state, state.orders[1]!.id, 'provider-chen');
    expect(preferredProviderId(state)).toBe('provider-chen');
    expect(preferredProviderId(createInitialState())).toBe('provider-wang');
    expect(preferredProviderId({ ...createInitialState(), providers: [] })).toBeUndefined();
  });

  it('rejects another provider starting or reporting an assigned order without mutation', () => {
    let state = createOrder(createInitialState(), draft);
    state = assignOrder(state, state.orders[0]!.id, 'provider-wang');
    const before = structuredClone(state);
    expect(() => startService(state, state.orders[0]!.id, 'provider-chen')).toThrow('只能操作分配给自己的订单');
    expect(state).toEqual(before);
    state = startService(state, state.orders[0]!.id, 'provider-wang');
    const inService = structuredClone(state);
    expect(() => submitReport(state, state.orders[0]!.id, 'provider-chen', completeReport)).toThrow('只能操作分配给自己的订单');
    expect(state).toEqual(inService);
  });

  it('rejects an unknown provider starting an assigned order without mutation', () => {
    let state = createOrder(createInitialState(), draft);
    state = assignOrder(state, state.orders[0]!.id, 'provider-wang');
    const beforeStart = structuredClone(state);
    expect(() => startService(state, state.orders[0]!.id, 'provider-unknown')).toThrow('请选择已认证服务人员');
    expect(state).toEqual(beforeStart);
  });

  it('rejects an unknown provider reporting an assigned order without mutation', () => {
    let state = createOrder(createInitialState(), draft);
    state = assignOrder(state, state.orders[0]!.id, 'provider-wang');
    state = startService(state, state.orders[0]!.id, 'provider-wang');
    const beforeReport = structuredClone(state);
    expect(() => submitReport(state, state.orders[0]!.id, 'provider-unknown', completeReport)).toThrow('请选择已认证服务人员');
    expect(state).toEqual(beforeReport);
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
    expect(state.providerApplications[0]).toMatchObject({ status: 'PENDING', createdAt: expect.any(String) });
    expect(state.providers.map((item) => item.name)).not.toContain('小林');

    state = approveProviderApplication(state, state.providerApplications[0]!.id);
    expect(state.providerApplications[0]).toMatchObject({
      status: 'APPROVED',
      reviewedAt: expect.any(String),
      providerId: expect.any(String),
    });
    expect(state.providers.at(-1)).toMatchObject({
      id: state.providerApplications[0]!.providerId,
      name: '小林',
      district: '秦淮区',
      verified: true,
    });
    expect(() => approveProviderApplication(state, state.providerApplications[0]!.id)).toThrow('申请已完成审核');
  });

  it('preserves approved applicants in the matching pool after reload', () => {
    const values = new Map<string, string>();
    const storage: DemoStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    let state = submitProviderApplication(createInitialState(), application);
    state = createOrder(state, { ...draft, district: '秦淮区', serviceType: 'DOG_WALKING' });
    state = approveProviderApplication(state, state.providerApplications[0]!.id);

    saveDemoState(storage, state);
    const restored = loadDemoState(storage);

    expect(eligibleProvidersForOrder(restored, restored.orders[0]!).map((provider) => provider.name)).toEqual(['小林']);
    expect(restored.providers.filter((provider) => provider.id === state.providerApplications[0]!.providerId)).toHaveLength(1);
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
      state.providerApplications[0]!.providerId,
      state.providerApplications[1]!.providerId,
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
    const sameDistrictWrongService = createOrder(state, { ...draft, district: '秦淮区', serviceType: 'CAT_FEEDING' });
    expect(() => assignOrder(sameDistrictWrongService, sameDistrictWrongService.orders.at(-1)!.id, state.providerApplications[0]!.providerId!))
      .toThrow('服务人员不支持该服务');
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

  it('drops invalid approved applications without discarding valid version-1 orders or providers', () => {
    const values = new Map<string, string>();
    const storage: DemoStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    const state = createOrder(createInitialState(), draft);
    values.set('nanjing-pet-care-demo-v1', JSON.stringify({
      ...state,
      providerApplications: [{
        id: 'provider-application-invalid-approved',
        name: '小林',
        district: '秦淮区',
        services: [],
        experience: application.experience,
        status: 'APPROVED',
        createdAt: '2026-08-24T10:00:00.000Z',
        reviewedAt: '2026-08-24T11:00:00.000Z',
        providerId: 'provider-invalid-approved',
      }],
    }));

    const restored = loadDemoState(storage);
    expect(restored.providerApplications).toEqual([]);
    expect(restored.orders).toEqual(state.orders);
    expect(restored.providers).toEqual(state.providers);
  });

  it('drops invalid pending applications without crashing or discarding valid version-1 orders', () => {
    const values = new Map<string, string>();
    const storage: DemoStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    const state = createOrder(createInitialState(), draft);
    values.set('nanjing-pet-care-demo-v1', JSON.stringify({
      ...state,
      providerApplications: [{
        id: 'provider-application-invalid-pending',
        name: '小林',
        district: '秦淮区',
        services: ['DOG_WALKING'],
        experience: application.experience,
        status: 'PENDING',
        createdAt: null,
      }],
    }));

    const restored = loadDemoState(storage);
    expect(restored.providerApplications).toEqual([]);
    expect(restored.orders).toEqual(state.orders);
    expect(restored.providers).toEqual(state.providers);
  });

  it('rebuilds providers from seeds and approved applications instead of persisted provider records', () => {
    const values = new Map<string, string>();
    const storage: DemoStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    let state = submitProviderApplication(createInitialState(), application);
    state = approveProviderApplication(state, state.providerApplications[0]!.id);
    state = createOrder(state, { ...draft, district: '秦淮区', serviceType: 'DOG_WALKING' });
    const expectedProviderIds = [...createInitialState().providers.map((provider) => provider.id), state.providerApplications[0]!.providerId];

    for (const persistedProviders of [
      [],
      [null],
      [{ id: 'provider-fake', name: '伪造人员', district: '秦淮区', services: ['DOG_WALKING'], verified: true }],
    ]) {
      values.set('nanjing-pet-care-demo-v1', JSON.stringify({ ...state, providers: persistedProviders }));
      const restored = loadDemoState(storage);
      expect(restored.orders).toEqual(state.orders);
      expect(restored.providers.map((provider) => provider.id)).toEqual(expectedProviderIds);
      expect(eligibleProvidersForOrder(restored, restored.orders[0]!).map((provider) => provider.name)).toEqual(['小林']);
    }
  });

  it('does not allow persisted verified providers to bypass pending application review', () => {
    const values = new Map<string, string>();
    const storage: DemoStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    let state = submitProviderApplication(createInitialState(), application);
    state = createOrder(state, { ...draft, district: '秦淮区', serviceType: 'DOG_WALKING' });
    values.set('nanjing-pet-care-demo-v1', JSON.stringify({
      ...state,
      providers: [{ id: 'provider-fake', name: '伪造人员', district: '秦淮区', services: ['DOG_WALKING'], verified: true }],
    }));

    const restored = loadDemoState(storage);
    expect(restored.orders).toEqual(state.orders);
    expect(restored.providers.map((provider) => provider.id)).toEqual(createInitialState().providers.map((provider) => provider.id));
    expect(eligibleProvidersForOrder(restored, restored.orders[0]!)).toEqual([]);
  });

  it('rejects application provider-ID collisions from pending and approved saved applications', () => {
    const values = new Map<string, string>();
    const storage: DemoStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    const state = createOrder(createInitialState(), draft);
    const pending = {
      id: 'wang', name: '小林', district: '秦淮区', services: ['DOG_WALKING'] as const, experience: application.experience,
      status: 'PENDING' as const, createdAt: '2026-08-24T10:00:00.000Z',
    };
    values.set('nanjing-pet-care-demo-v1', JSON.stringify({ ...state, providerApplications: [pending] }));
    expect(loadDemoState(storage).providerApplications).toEqual([]);

    values.set('nanjing-pet-care-demo-v1', JSON.stringify({
      ...state,
      providerApplications: [
        { ...pending, id: 'pending', createdAt: '2026-08-24T10:00:00.000Z' },
        {
          ...pending,
          id: 'approved',
          status: 'APPROVED',
          createdAt: '2026-08-24T10:05:00.000Z',
          reviewedAt: '2026-08-24T11:00:00.000Z',
          providerId: 'provider-pending',
        },
      ],
    }));
    expect(loadDemoState(storage).providerApplications).toEqual([]);
  });

  it('rejects approval when the derived provider ID collides with existing providers or approvals', () => {
    const pending = {
      id: 'wang', name: '小林', district: '秦淮区', services: ['DOG_WALKING'] as const, experience: application.experience,
      status: 'PENDING' as const, createdAt: '2026-08-24T10:00:00.000Z',
    };
    expect(() => approveProviderApplication({ ...createInitialState(), providerApplications: [pending] }, pending.id))
      .toThrow('服务人员 ID 已存在');

    const approved = {
      ...pending,
      id: 'approved',
      status: 'APPROVED' as const,
      reviewedAt: '2026-08-24T11:00:00.000Z',
      providerId: 'provider-pending',
    };
    const pendingWithConflict = { ...pending, id: 'pending' };
    expect(() => approveProviderApplication({
      ...createInitialState(),
      providerApplications: [approved, pendingWithConflict],
    }, pendingWithConflict.id)).toThrow('服务人员 ID 已存在');
  });

  it('canonicalizes parseable provider application timestamps on load', () => {
    const values = new Map<string, string>();
    const storage: DemoStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    let state = submitProviderApplication(createInitialState(), application);
    state = approveProviderApplication(state, state.providerApplications[0]!.id);
    const saved = JSON.parse(JSON.stringify(state));
    saved.providerApplications[0].createdAt = '2026-08-24T18:00:00+08:00';
    saved.providerApplications[0].reviewedAt = '2026-08-24T19:00:00+08:00';
    values.set('nanjing-pet-care-demo-v1', JSON.stringify(saved));

    expect(loadDemoState(storage).providerApplications[0]).toMatchObject({
      createdAt: '2026-08-24T10:00:00.000Z',
      reviewedAt: '2026-08-24T11:00:00.000Z',
    });
  });

  it('deduplicates provider application services in the domain layer', () => {
    const state = submitProviderApplication(createInitialState(), {
      ...application,
      services: ['DOG_WALKING', 'DOG_WALKING'],
    });

    expect(state.providerApplications[0]!.services).toEqual(['DOG_WALKING']);
  });
});
