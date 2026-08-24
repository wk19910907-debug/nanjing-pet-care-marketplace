export type DemoStatus =
  | 'WAITING_MATCH'
  | 'WAITING_SERVICE'
  | 'IN_SERVICE'
  | 'WAITING_CONFIRMATION'
  | 'COMPLETED';

export type ServiceType = 'CAT_FEEDING' | 'DOG_WALKING';

export type ProviderApplicationStatus = 'PENDING' | 'APPROVED';

export type ProviderApplicationDraft = {
  name: string;
  district: string;
  services: readonly ServiceType[];
  experience: string;
};

export type ProviderApplication = ProviderApplicationDraft & {
  id: string;
  status: ProviderApplicationStatus;
  createdAt: string;
  reviewedAt?: string;
  providerId?: string;
};

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
  providerApplications: ProviderApplication[];
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

const districts = ['建邺区', '鼓楼区', '玄武区', '秦淮区'];
const serviceTypes: ServiceType[] = ['CAT_FEEDING', 'DOG_WALKING'];

function createSeedProviders(): DemoProvider[] {
  return providers.map((provider) => ({ ...provider, services: [...provider.services] }));
}

export function createInitialState(): DemoState {
  return { version: 1, orders: [], providers: createSeedProviders(), providerApplications: [], audit: [] };
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

function requireDistrict(district: string): string {
  const cleaned = required(district, '服务区域');
  if (!districts.includes(cleaned)) throw new Error('服务区域无效');
  return cleaned;
}

function requireServices(services: readonly ServiceType[]): ServiceType[] {
  if (!services.length) throw new Error('请选择至少一项服务');
  if (services.some((service) => !serviceTypes.includes(service))) throw new Error('服务类型无效');
  return [...new Set(services)];
}

export function submitProviderApplication(state: DemoState, draft: ProviderApplicationDraft): DemoState {
  const name = required(draft.name, '姓名');
  const district = requireDistrict(draft.district);
  const experience = required(draft.experience, '服务经验');
  const services = requireServices(draft.services);
  const hasDuplicate = (item: Pick<ProviderApplicationDraft, 'name' | 'district'>) =>
    item.name === name && item.district === district;

  if (state.providers.some(hasDuplicate)) throw new Error('该服务人员已存在');
  if (state.providerApplications.some(hasDuplicate)) throw new Error('该服务人员已提交申请');

  return {
    ...state,
    providerApplications: [...state.providerApplications, {
      id: `provider-application-${state.providerApplications.length + 1}`,
      name,
      district,
      services,
      experience,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    }],
  };
}

export function approveProviderApplication(state: DemoState, applicationId: string): DemoState {
  const application = state.providerApplications.find((item) => item.id === applicationId);
  if (!application) throw new Error('未找到服务人员申请');
  if (application.status !== 'PENDING') throw new Error('申请已完成审核');
  const providerId = `provider-${application.id}`;
  if (state.providers.some((provider) => provider.id === providerId)
    || state.providerApplications.some((item) => item.id !== applicationId && item.status === 'APPROVED' && item.providerId === providerId)) {
    throw new Error('服务人员 ID 已存在');
  }

  const provider: DemoProvider = {
    id: providerId,
    name: application.name,
    district: application.district,
    services: [...application.services],
    verified: true,
  };
  return {
    ...state,
    providers: [...state.providers, provider],
    providerApplications: state.providerApplications.map((item) =>
      item.id === applicationId ? {
        ...item,
        status: 'APPROVED',
        reviewedAt: new Date().toISOString(),
        providerId,
      } : item),
  };
}

export function eligibleProvidersForOrder(state: DemoState, order: DemoOrder): DemoProvider[] {
  return state.providers.filter((provider) =>
    provider.verified
    && provider.district === order.district
    && provider.services.includes(order.serviceType));
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
  if (!eligibleProvidersForOrder(state, order).some((item) => item.id === providerId)) {
    if (provider.district !== order.district) throw new Error('服务人员不在订单服务区域');
    throw new Error('服务人员不支持该服务');
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizedTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date.toISOString();
  } catch {
    return null;
  }
}

function normalizedServices(value: unknown): ServiceType[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.some((service) => typeof service !== 'string' || !serviceTypes.includes(service as ServiceType))) {
    return null;
  }
  return [...new Set(value as ServiceType[])];
}

function normalizeProviderApplication(value: unknown): ProviderApplication | null {
  if (!isRecord(value)) return null;
  const id = normalizedString(value.id);
  const name = normalizedString(value.name);
  const district = normalizedString(value.district);
  const experience = normalizedString(value.experience);
  const createdAt = normalizedTimestamp(value.createdAt);
  const services = normalizedServices(value.services);
  if (!id || !name || !district || !experience || !createdAt || !services || !districts.includes(district)) return null;

  if (value.status === 'PENDING') {
    return { id, name, district, services, experience, status: 'PENDING', createdAt };
  }
  if (value.status !== 'APPROVED') return null;

  const reviewedAt = normalizedTimestamp(value.reviewedAt);
  const providerId = normalizedString(value.providerId);
  if (!reviewedAt || !providerId) return null;
  return { id, name, district, services, experience, status: 'APPROVED', createdAt, reviewedAt, providerId };
}

function normalizeProviderApplications(value: unknown): ProviderApplication[] {
  if (!Array.isArray(value)) return [];
  const applications = value.map(normalizeProviderApplication);
  if (applications.some((application) => application === null)) return [];
  const normalized = applications as ProviderApplication[];
  const applicationIds = new Set(normalized.map((application) => application.id));
  const providerIds = normalized.map((application) => application.status === 'APPROVED' ? application.providerId! : `provider-${application.id}`);
  if (applicationIds.size !== normalized.length || new Set(providerIds).size !== providerIds.length || providerIds.some((providerId) => providers.some((provider) => provider.id === providerId))) {
    return [];
  }
  return normalized;
}

export function loadDemoState(storage: DemoStorage): DemoState {
  const saved = storage.getItem(DEMO_STORAGE_KEY);
  if (!saved) return createInitialState();
  try {
    const parsed = JSON.parse(saved) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.orders) || !Array.isArray(parsed.audit)) {
      return createInitialState();
    }
    const providerApplications = normalizeProviderApplications(parsed.providerApplications);
    const approvedProviders = providerApplications.flatMap((application) => application.status === 'APPROVED' && application.providerId ? [{
      id: application.providerId,
      name: application.name,
      district: application.district,
      services: [...application.services],
      verified: true as const,
    }] : []);
    return {
      ...parsed,
      providers: [...createSeedProviders(), ...approvedProviders],
      providerApplications,
    } as DemoState;
  } catch {
    return createInitialState();
  }
}
