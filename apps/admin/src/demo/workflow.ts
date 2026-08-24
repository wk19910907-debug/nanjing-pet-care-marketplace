export type DemoStatus =
  | 'WAITING_MATCH'
  | 'WAITING_SERVICE'
  | 'IN_SERVICE'
  | 'WAITING_CONFIRMATION'
  | 'COMPLETED';

export type ServiceType = 'CAT_FEEDING' | 'DOG_WALKING';

export type OrderDraft = {
  serviceType: ServiceType;
  petName: string;
  district: string;
  address: string;
  scheduledAt: string;
  notes: string;
};

export type ServiceReport = {
  fedAndWatered: boolean;
  areaCleaned: boolean;
  notes: string;
};

export type DemoProvider = {
  id: string;
  name: string;
  district: string;
  services: ServiceType[];
  verified: true;
};

export type DemoOrder = OrderDraft & {
  id: string;
  createdAt: string;
  status: DemoStatus;
  priceFen: number;
  providerId?: string;
  report?: ServiceReport;
};

export type AuditEntry = {
  id: string;
  orderId: string;
  action: 'ORDER_CREATED' | 'ORDER_ASSIGNED' | 'SERVICE_STARTED' | 'REPORT_SUBMITTED' | 'ORDER_CONFIRMED';
  at: string;
};

export type DemoState = {
  version: 1;
  orders: DemoOrder[];
  providers: DemoProvider[];
  audit: AuditEntry[];
};

export type DemoStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export const DEMO_STORAGE_KEY = 'nanjing-pet-care-demo-v1';

const providers: DemoProvider[] = [
  { id: 'provider-wang', name: '王小宁', district: '建邺区', services: ['CAT_FEEDING', 'DOG_WALKING'], verified: true },
  { id: 'provider-chen', name: '陈安安', district: '鼓楼区', services: ['CAT_FEEDING', 'DOG_WALKING'], verified: true },
];

export function createInitialState(): DemoState {
  return { version: 1, orders: [], providers, audit: [] };
}

function requireOrder(state: DemoState, orderId: string): DemoOrder {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) throw new Error('未找到订单');
  return order;
}

function withOrder(state: DemoState, order: DemoOrder, action: AuditEntry['action']): DemoState {
  const at = new Date().toISOString();
  return {
    ...state,
    orders: state.orders.map((item) => item.id === order.id ? order : item),
    audit: [...state.audit, { id: `audit-${state.audit.length + 1}`, orderId: order.id, action, at }],
  };
}

function required(value: string, label: string): string {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`请填写${label}`);
  return cleaned;
}

export function createOrder(state: DemoState, draft: OrderDraft): DemoState {
  const createdAt = new Date().toISOString();
  const order: DemoOrder = {
    ...draft,
    petName: required(draft.petName, '宠物昵称'),
    district: required(draft.district, '服务区域'),
    address: required(draft.address, '详细地址'),
    scheduledAt: required(draft.scheduledAt, '上门时间'),
    notes: draft.notes.trim(),
    id: `NJ-${String(state.orders.length + 1).padStart(4, '0')}`,
    createdAt,
    status: 'WAITING_MATCH',
    priceFen: draft.serviceType === 'CAT_FEEDING' ? 3200 : 3700,
  };
  return {
    ...state,
    orders: [...state.orders, order],
    audit: [...state.audit, {
      id: `audit-${state.audit.length + 1}`,
      orderId: order.id,
      action: 'ORDER_CREATED',
      at: createdAt,
    }],
  };
}

export function assignOrder(state: DemoState, orderId: string, providerId: string): DemoState {
  const order = requireOrder(state, orderId);
  if (order.status !== 'WAITING_MATCH') throw new Error('订单当前不可匹配');
  const provider = state.providers.find((item) => item.id === providerId && item.verified);
  if (!provider) throw new Error('请选择已认证服务人员');
  if (!provider.services.includes(order.serviceType)) throw new Error('服务人员不支持该服务');
  return withOrder(state, { ...order, providerId, status: 'WAITING_SERVICE' }, 'ORDER_ASSIGNED');
}

export function startService(state: DemoState, orderId: string): DemoState {
  const order = requireOrder(state, orderId);
  if (order.status === 'WAITING_MATCH') throw new Error('订单尚未匹配服务人员');
  if (order.status !== 'WAITING_SERVICE') throw new Error('订单当前不可开始服务');
  return withOrder(state, { ...order, status: 'IN_SERVICE' }, 'SERVICE_STARTED');
}

export function submitReport(state: DemoState, orderId: string, report: ServiceReport): DemoState {
  const order = requireOrder(state, orderId);
  if (order.status !== 'IN_SERVICE') throw new Error('订单当前不可提交报告');
  if (!report.fedAndWatered || !report.areaCleaned) throw new Error('请完成全部服务清单');
  const notes = required(report.notes, '服务记录');
  return withOrder(state, {
    ...order,
    status: 'WAITING_CONFIRMATION',
    report: { ...report, notes },
  }, 'REPORT_SUBMITTED');
}

export function confirmOrder(state: DemoState, orderId: string): DemoState {
  const order = requireOrder(state, orderId);
  if (order.status !== 'WAITING_CONFIRMATION') throw new Error('订单尚未等待确认');
  return withOrder(state, { ...order, status: 'COMPLETED' }, 'ORDER_CONFIRMED');
}

export function saveDemoState(storage: DemoStorage, state: DemoState): void {
  storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
}

export function loadDemoState(storage: DemoStorage): DemoState {
  const saved = storage.getItem(DEMO_STORAGE_KEY);
  if (!saved) return createInitialState();
  try {
    const parsed = JSON.parse(saved) as DemoState;
    if (parsed.version !== 1 || !Array.isArray(parsed.orders) || !Array.isArray(parsed.audit)) {
      return createInitialState();
    }
    return { ...parsed, providers };
  } catch {
    return createInitialState();
  }
}
