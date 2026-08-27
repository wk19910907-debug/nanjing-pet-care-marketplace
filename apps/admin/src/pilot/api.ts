import type {
  PilotInvite,
  PilotInviteCreated,
  PilotInviteRole,
  PilotProfile,
  PilotSession,
  PilotSessionCreated,
  CreateOwnerAddress,
  CreateOwnerOrder,
  CreateOwnerPet,
  OwnerAddress,
  OwnerOrder,
  OwnerOrderCreated,
  OwnerPet,
  OrderStatus,
  PilotChecklist,
  QuoteBreakdown,
  QuoteRequest,
  ServiceType,
} from './models.js';
import { PILOT_DISTRICTS } from './districts.js';

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  INVITE_INVALID: '邀请码无效或已失效',
  LOGIN_RATE_LIMITED: '尝试次数过多，请稍后再试',
  DISPLAY_NAME_INVALID: '昵称格式不符合要求',
  VALIDATION_ERROR: '提交内容格式不符合要求',
  UNAUTHENTICATED: '登录状态已失效，请重新登录',
  FORBIDDEN: '你没有权限执行此操作',
  ONBOARDING_REQUIRED: '请先设置展示昵称',
  SERVICE_UNAVAILABLE: '服务暂时不可用，请稍后重试',
};

export class PilotApiError extends Error {
  public readonly name = 'PilotApiError';

  public constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.SERVICE_UNAVAILABLE);
  }
}

export function pilotErrorMessage(error: unknown): string {
  return error instanceof PilotApiError
    ? error.message
    : '服务暂时不可用，请稍后重试';
}

export interface PilotApi {
  getSession(): Promise<PilotSession>;
  createSession(inviteCode: string): Promise<PilotSessionCreated>;
  updateProfile(displayName: string): Promise<PilotProfile>;
  deleteSession(): Promise<void>;
  createInvite(role: PilotInviteRole): Promise<PilotInviteCreated>;
  listInvites(): Promise<PilotInvite[]>;
  listPets(): Promise<OwnerPet[]>;
  createPet(input: CreateOwnerPet): Promise<OwnerPet>;
  listAddresses(): Promise<OwnerAddress[]>;
  createAddress(input: CreateOwnerAddress): Promise<OwnerAddress>;
  getQuote(input: QuoteRequest): Promise<QuoteBreakdown>;
  createOrder(input: CreateOwnerOrder, idempotencyKey: string): Promise<OwnerOrderCreated>;
  listOrders(): Promise<OwnerOrder[]>;
  confirmOrder(orderId: string): Promise<void>;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;

const PILOT_ROLES = ['OWNER', 'PROVIDER', 'ADMIN'] as const;
const INVITE_ROLES = ['OWNER', 'PROVIDER'] as const;
const PET_SPECIES = ['CAT', 'DOG'] as const;
const SERVICE_TYPES = ['CAT_FEEDING', 'DOG_WALKING'] as const;
const ORDER_STATUSES = [
  'PENDING_PAYMENT', 'PENDING_DISPATCH', 'PENDING_SERVICE', 'IN_SERVICE',
  'PENDING_CONFIRMATION', 'COMPLETED', 'CANCELLED', 'REFUND_PENDING',
  'REFUNDED', 'DISPUTED', 'DISPATCH_FAILED', 'EXPIRED',
] as const satisfies readonly OrderStatus[];
const DISTRICTS = new Set<string>(PILOT_DISTRICTS.map(({ district }) => district));
const CREDENTIAL_FIELD_NAMES = new Set([
  'codehash',
  'invitationcode',
  'invitecode',
  'rawcode',
]);
const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

function invalidResponse(): never {
  throw new PilotApiError(503, 'SERVICE_UNAVAILABLE');
}

function asRecord(value: unknown): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidResponse();
  return value as JsonRecord;
}

function asString(record: JsonRecord, key: string, maximum = 512): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) invalidResponse();
  return value;
}

function asOptionalString(record: JsonRecord, key: string, maximum = 512): string | undefined {
  if (record[key] === undefined) return undefined;
  return asString(record, key, maximum);
}

function asInteger(record: JsonRecord, key: string, maximum = Number.MAX_SAFE_INTEGER): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    invalidResponse();
  }
  return value as number;
}

function asEnum<T extends string>(record: JsonRecord, key: string, values: readonly T[]): T {
  const value = record[key];
  if (typeof value !== 'string' || !values.includes(value as T)) invalidResponse();
  return value as T;
}

function isStrictIsoTimestamp(value: string): boolean {
  const match = ISO_TIMESTAMP.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  if (!yearText || !monthText || !dayText || !hourText || !minuteText || !secondText || !zone) {
    return false;
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 || month > 12
    || day < 1 || day > (daysInMonth[month - 1] ?? 0)
    || hour > 23 || minute > 59 || second > 59
  ) return false;
  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
      return false;
    }
  }
  return Number.isFinite(Date.parse(value));
}

function asDate(record: JsonRecord, key: string): string {
  const value = asString(record, key, 64);
  if (!isStrictIsoTimestamp(value)) invalidResponse();
  return value;
}

function asDisplayName(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 30
    || value !== value.trim()
  ) invalidResponse();
  return value;
}

function asRole(record: JsonRecord): PilotSession['role'] {
  const role = record.role;
  if (typeof role !== 'string' || !(PILOT_ROLES as readonly string[]).includes(role)) {
    invalidResponse();
  }
  return role as PilotSession['role'];
}

function asInviteRole(record: JsonRecord): PilotInviteRole {
  const role = record.role;
  if (typeof role !== 'string' || !(INVITE_ROLES as readonly string[]).includes(role)) {
    invalidResponse();
  }
  return role as PilotInviteRole;
}

function rejectCredentialFields(record: JsonRecord, allowCode = false): void {
  const unsafe = Object.keys(record).some((key) => {
    const canonical = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    return canonical.includes('token')
      || CREDENTIAL_FIELD_NAMES.has(canonical)
      || (!allowCode && canonical === 'code');
  });
  if (unsafe) invalidResponse();
}

function parseSession(value: unknown): PilotSession {
  const record = asRecord(value);
  rejectCredentialFields(record);
  const displayName = record.displayName;
  return {
    userId: asString(record, 'userId', 128),
    role: asRole(record),
    displayName: displayName === null ? null : asDisplayName(displayName),
    expiresAt: asDate(record, 'expiresAt'),
  };
}

function parseSessionCreated(value: unknown): PilotSessionCreated {
  const record = asRecord(value);
  rejectCredentialFields(record);
  return { expiresAt: asDate(record, 'expiresAt') };
}

function parseProfile(value: unknown): PilotProfile {
  const record = asRecord(value);
  rejectCredentialFields(record);
  const displayName = asDisplayName(record.displayName);
  return { id: asString(record, 'id', 128), role: asRole(record), displayName };
}

function parseInviteCreated(value: unknown): PilotInviteCreated {
  const record = asRecord(value);
  rejectCredentialFields(record, true);
  return {
    id: asString(record, 'id', 128),
    role: asInviteRole(record),
    code: asString(record, 'code', 512),
    expiresAt: asDate(record, 'expiresAt'),
    createdAt: asDate(record, 'createdAt'),
  };
}

function parseInvite(value: unknown): PilotInvite {
  const record = asRecord(value);
  rejectCredentialFields(record);
  const consumedAt = record.consumedAt;
  if (consumedAt !== null && (
    typeof consumedAt !== 'string' || !isStrictIsoTimestamp(consumedAt)
  )) invalidResponse();
  return {
    id: asString(record, 'id', 128),
    role: asRole(record),
    expiresAt: asDate(record, 'expiresAt'),
    consumedAt,
    createdAt: asDate(record, 'createdAt'),
  };
}

function parseInvites(value: unknown): PilotInvite[] {
  if (!Array.isArray(value) || value.length > 100) invalidResponse();
  return value.map(parseInvite);
}

function parsePet(value: unknown): OwnerPet {
  const record = asRecord(value);
  return {
    id: asString(record, 'id', 128),
    name: asString(record, 'name', 50),
    species: asEnum(record, 'species', PET_SPECIES),
    sensitiveNotes: typeof record.sensitiveNotes === 'string' && record.sensitiveNotes.length <= 1000
      ? record.sensitiveNotes
      : invalidResponse(),
  };
}

function parsePets(value: unknown): OwnerPet[] {
  if (!Array.isArray(value) || value.length > 100) invalidResponse();
  return value.map(parsePet);
}

function parsePilotLocation(record: Record<string, unknown>) {
  const city = asEnum(record, 'city', ['南京市'] as const);
  const district = asString(record, 'district', 30);
  const serviceZone = asString(record, 'serviceZone', 50);
  if (!DISTRICTS.has(district) || serviceZone !== district) invalidResponse();
  return { city, district, serviceZone };
}

function parseAddress(value: unknown): OwnerAddress {
  const record = asRecord(value);
  return { id: asString(record, 'id', 128), ...parsePilotLocation(record) };
}

function parseAddresses(value: unknown): OwnerAddress[] {
  if (!Array.isArray(value) || value.length > 100) invalidResponse();
  return value.map(parseAddress);
}

function parseQuote(value: unknown): QuoteBreakdown {
  const record = asRecord(value);
  return {
    baseFen: asInteger(record, 'baseFen'),
    extraPetFen: asInteger(record, 'extraPetFen'),
    durationFen: asInteger(record, 'durationFen'),
    distanceFen: asInteger(record, 'distanceFen'),
    holidayFen: asInteger(record, 'holidayFen'),
    totalFen: asInteger(record, 'totalFen'),
    currency: asEnum(record, 'currency', ['CNY'] as const),
  };
}

function parseChecklist(value: unknown): PilotChecklist {
  const record = asRecord(value);
  const entries = Object.entries(record);
  if (entries.length > 30) invalidResponse();
  const checklist: PilotChecklist = {};
  for (const [key, item] of entries) {
    if (key.length < 1 || key.length > 80) invalidResponse();
    if (
      item !== null
      && typeof item !== 'boolean'
      && typeof item !== 'number'
      && (typeof item !== 'string' || item.length > 500)
    ) invalidResponse();
    checklist[key] = item as PilotChecklist[string];
  }
  return checklist;
}

function parseOrder(value: unknown): OwnerOrder {
  const record = asRecord(value);
  const location = parsePilotLocation(record);
  const reportValue = record.report;
  let report: OwnerOrder['report'];
  if (reportValue !== undefined) {
    const reportRecord = asRecord(reportValue);
    const notes = reportRecord.notes;
    if (typeof notes !== 'string' || notes.length > 1000) invalidResponse();
    report = {
      notes,
      submittedAt: asDate(reportRecord, 'submittedAt'),
      checklist: parseChecklist(reportRecord.checklist),
    };
  }
  return {
    id: asString(record, 'id', 128),
    serviceType: asEnum<ServiceType>(record, 'serviceType', SERVICE_TYPES),
    status: asEnum<OrderStatus>(record, 'status', ORDER_STATUSES),
    startsAt: asDate(record, 'startsAt'),
    durationMinutes: asInteger(record, 'durationMinutes', 180),
    totalFen: asInteger(record, 'totalFen'),
    currency: asEnum(record, 'currency', ['CNY'] as const),
    ...location,
    ...(asOptionalString(record, 'providerDisplayName', 30) !== undefined
      ? { providerDisplayName: asOptionalString(record, 'providerDisplayName', 30)! }
      : {}),
    ...(record.notes !== undefined
      ? { notes: typeof record.notes === 'string' && record.notes.length <= 500
          ? record.notes
          : invalidResponse() }
      : {}),
    ...(report ? { report } : {}),
  };
}

function parseOrders(value: unknown): OwnerOrder[] {
  if (!Array.isArray(value) || value.length > 100) invalidResponse();
  return value.map(parseOrder);
}

function parseOrderCreated(value: unknown): OwnerOrderCreated {
  const record = asRecord(value);
  if (record.paymentToken !== null) invalidResponse();
  return {
    id: asString(record, 'id', 128),
    status: asEnum<OrderStatus>(record, 'status', ORDER_STATUSES),
    totalFen: asInteger(record, 'totalFen'),
    currency: asEnum(record, 'currency', ['CNY'] as const),
  };
}

export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}

async function safeErrorCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === 'object'
      && body !== null
      && 'code' in body
      && typeof body.code === 'string'
      && Object.hasOwn(ERROR_MESSAGES, body.code)
    ) {
      return body.code;
    }
  } catch {
    // Deliberately discard untrusted response bodies.
  }
  return 'SERVICE_UNAVAILABLE';
}

export function createPilotApi(fetcher: Fetcher = fetch): PilotApi {
  async function request(
    path: string,
    init: RequestInit = {},
    expectedStatus: number | readonly number[] = 200,
  ): Promise<unknown> {
    const method = init.method?.toUpperCase() ?? 'GET';
    const writeHeaders = method === 'GET' || method === 'HEAD'
      ? {}
      : { 'Idempotency-Key': createIdempotencyKey() };
    let response: Response;
    try {
      response = await fetcher(`/api${path}`, {
        ...init,
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...writeHeaders,
          ...init.headers,
        },
      });
    } catch {
      throw new PilotApiError(503, 'SERVICE_UNAVAILABLE');
    }
    if (!response.ok) throw new PilotApiError(response.status, await safeErrorCode(response));
    const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
    if (!expected.includes(response.status)) invalidResponse();
    if (response.status === 204) return undefined;
    try {
      return await response.json() as unknown;
    } catch {
      throw new PilotApiError(503, 'SERVICE_UNAVAILABLE');
    }
  }

  return {
    getSession: async () => parseSession(await request('/v1/pilot/session')),
    createSession: async (inviteCode) => parseSessionCreated(await request(
      '/v1/pilot/sessions',
      { method: 'POST', body: JSON.stringify({ inviteCode }) },
      201,
    )),
    updateProfile: async (displayName) => parseProfile(await request('/v1/pilot/me', {
      method: 'PATCH', body: JSON.stringify({ displayName }),
    })),
    deleteSession: async () => {
      await request('/v1/pilot/session', { method: 'DELETE' }, 204);
    },
    createInvite: async (role) => parseInviteCreated(await request(
      '/v1/pilot/invites',
      { method: 'POST', body: JSON.stringify({ role }) },
      201,
    )),
    listInvites: async () => parseInvites(await request('/v1/pilot/invites')),
    listPets: async () => parsePets(await request('/v1/pets')),
    createPet: async (input) => parsePet(await request(
      '/v1/pets', { method: 'POST', body: JSON.stringify(input) }, 201,
    )),
    listAddresses: async () => parseAddresses(await request('/v1/addresses')),
    createAddress: async (input) => parseAddress(await request(
      '/v1/addresses', { method: 'POST', body: JSON.stringify(input) }, 201,
    )),
    getQuote: async (input) => parseQuote(await request(
      '/v1/quotes', { method: 'POST', body: JSON.stringify(input) },
    )),
    createOrder: async (input, idempotencyKey) => parseOrderCreated(await request(
      '/v1/orders',
      {
        method: 'POST', body: JSON.stringify(input),
        headers: { 'Idempotency-Key': idempotencyKey },
      },
      [200, 201],
    )),
    listOrders: async () => parseOrders(await request('/v1/pilot/orders')),
    confirmOrder: async (orderId) => {
      await request(`/v1/orders/${encodeURIComponent(orderId)}/confirm`, { method: 'POST' });
    },
  };
}

export const pilotApi = createPilotApi();
