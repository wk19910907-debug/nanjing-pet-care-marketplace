export type MiniStatus = 'WAITING_MATCH' | 'WAITING_SERVICE' | 'IN_SERVICE' | 'WAITING_CONFIRMATION' | 'COMPLETED';
export type MiniServiceType = 'CAT_FEEDING' | 'DOG_WALKING';
export type MiniOrderDraft = { serviceType: MiniServiceType; petName: string; district: string; address: string; scheduledAt: string };
export type MiniReport = { fed: boolean; cleaned: boolean; notes: string };
export type MiniOrder = MiniOrderDraft & { id: string; status: MiniStatus; priceFen: number; providerName?: string; report?: MiniReport };
export type MiniState = { version: 1; order: MiniOrder | null; updatedAt: string };
export type MiniStorage = { get(key: string): string | undefined; set(key: string, value: string): void };

const KEY = 'nanjing-pet-care-mini-demo-v1';
export function initialMiniState(): MiniState { return { version: 1, order: null, updatedAt: new Date(0).toISOString() }; }

function required(value: string, label: string): string {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`请填写${label}`);
  return cleaned;
}

function orderFor(state: MiniState, id: string): MiniOrder {
  if (!state.order || state.order.id !== id) throw new Error('未找到订单');
  return state.order;
}

function update(state: MiniState, order: MiniOrder): MiniState { return { ...state, order, updatedAt: new Date().toISOString() }; }

export function createMiniOrder(state: MiniState, draft: MiniOrderDraft): MiniState {
  const order: MiniOrder = {
    ...draft,
    petName: required(draft.petName, '宠物昵称'), district: required(draft.district, '服务区域'),
    address: required(draft.address, '详细地址'), scheduledAt: required(draft.scheduledAt, '上门时间'),
    id: 'NJ-MINI-001', status: 'WAITING_MATCH', priceFen: draft.serviceType === 'CAT_FEEDING' ? 3200 : 3700,
  };
  return update(state, order);
}

export function assignMiniOrder(state: MiniState, id: string): MiniState {
  const order = orderFor(state, id);
  if (order.status !== 'WAITING_MATCH') throw new Error('订单当前不可匹配');
  return update(state, { ...order, status: 'WAITING_SERVICE', providerName: '王小宁' });
}

export function startMiniService(state: MiniState, id: string): MiniState {
  const order = orderFor(state, id);
  if (order.status !== 'WAITING_SERVICE') throw new Error('订单当前不可开始服务');
  return update(state, { ...order, status: 'IN_SERVICE' });
}

export function submitMiniReport(state: MiniState, id: string, report: MiniReport): MiniState {
  const order = orderFor(state, id);
  if (order.status !== 'IN_SERVICE') throw new Error('订单当前不可提交报告');
  if (!report.fed || !report.cleaned) throw new Error('请完成全部服务清单');
  const notes = required(report.notes, '服务记录');
  return update(state, { ...order, status: 'WAITING_CONFIRMATION', report: { ...report, notes } });
}

export function confirmMiniOrder(state: MiniState, id: string): MiniState {
  const order = orderFor(state, id);
  if (order.status !== 'WAITING_CONFIRMATION') throw new Error('订单尚未等待确认');
  return update(state, { ...order, status: 'COMPLETED' });
}

export function saveMiniState(storage: MiniStorage, state: MiniState): void { storage.set(KEY, JSON.stringify(state)); }
export function loadMiniState(storage: MiniStorage): MiniState {
  try {
    const saved = storage.get(KEY);
    if (!saved) return initialMiniState();
    const parsed = JSON.parse(saved) as MiniState;
    return parsed.version === 1 ? parsed : initialMiniState();
  } catch { return initialMiniState(); }
}
