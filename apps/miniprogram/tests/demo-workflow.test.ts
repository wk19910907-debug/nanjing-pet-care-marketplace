import { describe, expect, it } from 'vitest';
import {
  assignMiniOrder,
  confirmMiniOrder,
  createMiniOrder,
  initialMiniState,
  loadMiniState,
  saveMiniState,
  startMiniService,
  submitMiniReport,
  type MiniStorage,
} from '../demo/workflow.js';

describe('mini program experience workflow', () => {
  it('completes and persists one managed pet-service order', () => {
    let state = createMiniOrder(initialMiniState(), {
      serviceType: 'CAT_FEEDING', petName: '团子', district: '建邺区',
      address: '测试小区 1 栋', scheduledAt: '2026-08-24 19:00',
    });
    const id = state.order!.id;
    state = assignMiniOrder(state, id);
    state = startMiniService(state, id);
    expect(() => submitMiniReport(state, id, { fed: true, cleaned: false, notes: '已喂食' })).toThrow('请完成全部服务清单');
    state = submitMiniReport(state, id, { fed: true, cleaned: true, notes: '宠物状态良好。' });
    state = confirmMiniOrder(state, id);
    expect(state.order!.status).toBe('COMPLETED');

    const values = new Map<string, string>();
    const storage: MiniStorage = { get: (key) => values.get(key), set: (key, value) => values.set(key, value) };
    saveMiniState(storage, state);
    expect(loadMiniState(storage)).toEqual(state);
  });
});
