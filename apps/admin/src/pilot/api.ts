import type {
  PilotInvite,
  PilotInviteCreated,
  PilotInviteRole,
  LocalPilotRole,
  PilotProfile,
  PilotSession,
  PilotSessionCreated,
  OwnerRecoveryCredential,
  StaffSessionCreated,
  StaffAccount,
  CreateStaffAccount,
  UpdateStaffAccount,
  OrderMessage,
  OrderMessagePage,
  CreateOwnerAddress,
  CreateOwnerOrder,
  CreateOwnerPet,
  OwnerAddress,
  OwnerOrder,
  OwnerOrderCreated,
  OwnerConfirmation,
  OwnerPet,
  OrderStatus,
  PilotChecklist,
  QuoteBreakdown,
  QuoteRequest,
  ServiceType,
  AdminOrder,
  AssignedAddress,
  AttachEvidenceInput,
  EvidenceMedia,
  EvidenceUpload,
  EvidenceRead,
  ProviderApplicationInput,
  ProviderAvailabilityInput,
  ProviderOrder,
  ProviderReviewQueueItem,
  ReviewStatus,
  SubmitReportInput,
  AdminOperationsCatalog,
  OperationsCatalogUpdate,
  PublicOperationsCatalog,
} from './models.js';
import {
  AdminOperationsCatalogSchema,
  PublicOperationsCatalogSchema,
} from '@pet/contracts';
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
  RATE_LIMITED: '操作过于频繁，请稍后再试',
  PASSWORD_CHANGE_REQUIRED: '请先修改临时密码',
  STAFF_ACCOUNT_DISABLED: '该员工账号已停用',
  USERNAME_UNAVAILABLE: '该用户名不可用',
  ORDER_NOT_FOUND: '订单不存在或无权访问',
  RECOVERY_INVALID: '恢复凭据无效或已失效',
  RECOVERY_ALREADY_ISSUED: '恢复凭据已签发，请使用或轮换现有凭据',
  RECOVERY_NOT_ISSUED: '尚未签发恢复凭据',
  STAFF_LOGIN_INVALID: '用户名或密码不正确',
  STAFF_LOGIN_BUSY: '登录服务繁忙，请稍后重试',
  GUEST_CREATION_RATE_LIMITED: '访客创建过于频繁，请稍后再试',
  MANUAL_FEE_CONFLICT: '费用状态已变化，请刷新后重试',
  DISPATCH_NOT_ALLOWED: '当前订单不能启动派单，请刷新后重试',
  DISPATCH_CONFLICT: '邀请状态已变化，请刷新后重试',
  PROVIDER_NOT_FOUND: '请先提交服务申请',
  FULFILLMENT_NOT_ALLOWED: '当前任务不能执行此操作，请刷新后重试',
  FULFILLMENT_CONFLICT: '任务状态已变化，请刷新后重试',
  CHECK_IN_OUTSIDE_WINDOW: '当前不在允许签到的时间窗内',
  CHECKLIST_INCOMPLETE: '请完成本服务的全部清单',
  EVIDENCE_REQUIRED: '请先上传履约图片',
  CHECK_IN_REQUIRED: '请先完成签到',
  AFTER_STATE_REQUIRED: '请确认服务后的宠物状态',
  MEDIA_TYPE_NOT_ALLOWED: '仅支持 JPG、PNG 或 WebP 图片',
  MEDIA_TOO_LARGE: '图片过大，请选择较小文件',
  UPLOAD_NOT_VERIFIED: '图片上传校验失败，请重新上传',
  EVIDENCE_QUOTA_EXCEEDED: '图片上传次数过多，请稍后重试',
  OPERATIONS_CATALOG_CONFLICT: '运营配置已被其他管理员修改，请刷新后重试',
  SERVICE_NOT_AVAILABLE: '该服务当前暂停接单',
  AREA_NOT_AVAILABLE: '该区域当前暂停接单',
};

export class PilotApiError extends Error {
  public readonly name = 'PilotApiError';

  public constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly retryAfterSeconds?: number,
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
  createLocalSession(role: LocalPilotRole): Promise<PilotSessionCreated>;
  ensureOwnerSession(): Promise<PilotSessionCreated>;
  issueRecoveryCredential(): Promise<OwnerRecoveryCredential>;
  rotateRecoveryCredential(): Promise<OwnerRecoveryCredential>;
  recoverOwnerSession(token: string): Promise<PilotSessionCreated>;
  createStaffSession(username: string, password: string): Promise<StaffSessionCreated>;
  changeStaffPassword(password: string): Promise<StaffSessionCreated>;
  listStaffAccounts(): Promise<StaffAccount[]>;
  createStaffAccount(input: CreateStaffAccount): Promise<StaffAccount>;
  updateStaffAccount(userId: string, input: UpdateStaffAccount): Promise<StaffAccount>;
  resetStaffPassword(userId: string, temporaryPassword: string): Promise<void>;
  listOrderMessages(orderId: string, cursor?: string): Promise<OrderMessagePage>;
  sendOrderMessage(orderId: string, body: string): Promise<OrderMessage>;
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
  confirmOrder(orderId: string): Promise<OwnerConfirmation>;
  getEvidenceReadUrl(evidenceId: string): Promise<EvidenceRead>;
  listAdminOrders(): Promise<AdminOrder[]>;
  listProviderOrders(): Promise<ProviderOrder[]>;
  listProviderReviewQueue(): Promise<ProviderReviewQueueItem[]>;
  reviewProvider(profileId: string, status: Exclude<ReviewStatus, 'PENDING'>): Promise<void>;
  confirmManualFee(orderId: string, idempotencyKey: string): Promise<void>;
  startDispatch(orderId: string): Promise<void>;
  applyProvider(input: ProviderApplicationInput): Promise<void>;
  setProviderAvailability(input: ProviderAvailabilityInput): Promise<void>;
  acceptInvitation(invitationId: string): Promise<void>;
  getAssignedAddress(orderId: string): Promise<AssignedAddress>;
  checkIn(orderId: string, beforeState: PilotChecklist): Promise<{ id: string; orderId: string; checkedInAt: string }>;
  issueEvidenceUpload(orderId: string, media: EvidenceMedia): Promise<EvidenceUpload>;
  uploadEvidence(uploadUrl: string, bytes: Uint8Array, mimeType: string, uploadHeaders?: EvidenceUpload['uploadHeaders']): Promise<void>;
  attachEvidence(orderId: string, input: AttachEvidenceInput): Promise<{ id: string }>;
  submitReport(orderId: string, input: SubmitReportInput): Promise<{ id: string; orderId: string; submittedAt: string }>;
  getCatalog(): Promise<PublicOperationsCatalog>;
  getAdminCatalog(): Promise<AdminOperationsCatalog>;
  updateAdminCatalog(input: OperationsCatalogUpdate): Promise<AdminOperationsCatalog>;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;

const PILOT_ROLES = ['OWNER', 'PROVIDER', 'ADMIN'] as const;
const INVITE_ROLES = ['OWNER', 'PROVIDER'] as const;
const PET_SPECIES = ['CAT', 'DOG'] as const;
const SERVICE_TYPES = ['CAT_FEEDING', 'DOG_WALKING'] as const;
const REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const;
const INVITATION_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED'] as const;
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
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
  'passwordhash',
  'cookie',
  'setcookie',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECOVERY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

function invalidResponse(): never {
  throw new PilotApiError(503, 'SERVICE_UNAVAILABLE');
}

function validationError(): never { throw new PilotApiError(400, 'VALIDATION_ERROR'); }

function asUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) invalidResponse();
  return value;
}

function assertUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) validationError();
}

function hasExactKeys(record: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function parsePublicCatalog(value: unknown): PublicOperationsCatalog {
  const parsed = PublicOperationsCatalogSchema.safeParse(value);
  if (!parsed.success) invalidResponse();
  return parsed.data;
}

function parseAdminCatalog(value: unknown): AdminOperationsCatalog {
  const parsed = AdminOperationsCatalogSchema.safeParse(value);
  if (!parsed.success) invalidResponse();
  return parsed.data;
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
      || canonical === 'password'
      || canonical.includes('cookie')
      || CREDENTIAL_FIELD_NAMES.has(canonical)
      || (!allowCode && canonical === 'code');
  });
  if (unsafe) invalidResponse();
}

function parseSession(value: unknown): PilotSession {
  const record = asRecord(value);
  rejectCredentialFields(record);
  const displayName = record.displayName;
  const mustChangePassword = record.mustChangePassword;
  if (mustChangePassword !== undefined && typeof mustChangePassword !== 'boolean') invalidResponse();
  return {
    userId: asString(record, 'userId', 128),
    role: asRole(record),
    displayName: displayName === null ? null : asDisplayName(displayName),
    expiresAt: asDate(record, 'expiresAt'),
    mustChangePassword: mustChangePassword ?? false,
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

function parseChecklist(value: unknown, serviceType: ServiceType): PilotChecklist {
  const record = asRecord(value);
  const expected: readonly string[] = serviceType === 'CAT_FEEDING'
    ? ['petCountConfirmed', 'foodRefilled', 'waterRefilled', 'litterCleaned']
    : ['leashSecured', 'walkDurationMinutes'];
  const keys = Object.keys(record);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    invalidResponse();
  }
  if (serviceType === 'CAT_FEEDING') {
    if (expected.some((key) => record[key] !== true)) invalidResponse();
  } else if (
    record.leashSecured !== true
    || typeof record.walkDurationMinutes !== 'number'
    || !Number.isFinite(record.walkDurationMinutes)
    || record.walkDurationMinutes <= 0
  ) {
    invalidResponse();
  }
  return record as PilotChecklist;
}

function parsePetNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) invalidResponse();
  return value.map((name) => {
    if (typeof name !== 'string' || name.trim().length < 1 || name.length > 50) {
      return invalidResponse();
    }
    return name;
  });
}

function parseOrder(value: unknown): OwnerOrder {
  const record = asRecord(value);
  const serviceType = asEnum<ServiceType>(record, 'serviceType', SERVICE_TYPES);
  const location = parsePilotLocation(record);
  const reportValue = record.report;
  let report: OwnerOrder['report'];
  let evidence: Array<{ id: string }> | undefined;
  if (reportValue !== undefined) {
    const reportRecord = asRecord(reportValue);
    const notes = reportRecord.notes;
    if (typeof notes !== 'string' || notes.length > 1000) invalidResponse();
    report = {
      notes,
      submittedAt: asDate(reportRecord, 'submittedAt'),
      checklist: parseChecklist(reportRecord.checklist, serviceType),
    };
  }
  if (record.evidence !== undefined) {
    if (!Array.isArray(record.evidence) || record.evidence.length > 12) invalidResponse();
    evidence = record.evidence.map((item) => ({ id: asString(asRecord(item), 'id', 128) }));
  }
  return {
    id: asString(record, 'id', 128),
    serviceType,
    status: asEnum<OrderStatus>(record, 'status', ORDER_STATUSES),
    startsAt: asDate(record, 'startsAt'),
    durationMinutes: asInteger(record, 'durationMinutes', 180),
    totalFen: asInteger(record, 'totalFen'),
    currency: asEnum(record, 'currency', ['CNY'] as const),
    ...location,
    ...(record.petNames !== undefined ? { petNames: parsePetNames(record.petNames) } : {}),
    ...(asOptionalString(record, 'providerDisplayName', 30) !== undefined
      ? { providerDisplayName: asOptionalString(record, 'providerDisplayName', 30)! }
      : {}),
    ...(record.notes !== undefined
      ? { notes: typeof record.notes === 'string' && record.notes.length <= 500
          ? record.notes
          : invalidResponse() }
      : {}),
    ...(report ? { report } : {}),
    ...(evidence ? { evidence } : {}),
  };
}

function parseOrders(value: unknown): OwnerOrder[] {
  if (!Array.isArray(value) || value.length > 100) invalidResponse();
  return value.map(parseOrder);
}

function parseAdminOrder(value: unknown): AdminOrder {
  const record = asRecord(value);
  const order = parseOrder(record);
  const ownerDisplayName = asOptionalString(record, 'ownerDisplayName', 30);
  return { ...order, ...(ownerDisplayName ? { ownerDisplayName } : {}) };
}

function parseAdminOrders(value: unknown): AdminOrder[] {
  if (!Array.isArray(value) || value.length > 100) invalidResponse();
  return value.map(parseAdminOrder);
}

function parseInvitation(record: JsonRecord) {
  return {
    id: asString(record, 'id', 128),
    status: asEnum(record, 'status', INVITATION_STATUSES),
    expiresAt: asDate(record, 'expiresAt'),
  };
}

function parseProviderOrder(value: unknown): ProviderOrder {
  const record = asRecord(value);
  const invitationValue = record.invitation;
  const invitation = invitationValue === undefined
    ? undefined
    : parseInvitation(asRecord(invitationValue));
  if (record.status === undefined) {
    if (!invitation) invalidResponse();
    return {
      id: asString(record, 'id', 128),
      serviceType: asEnum<ServiceType>(record, 'serviceType', SERVICE_TYPES),
      startsAt: asDate(record, 'startsAt'),
      durationMinutes: asInteger(record, 'durationMinutes', 180),
      ...parsePilotLocation(record),
      invitation,
    };
  }
  const ownerOrder = parseOrder(record);
  const ownerDisplayName = asOptionalString(record, 'ownerDisplayName', 30);
  const evidenceValue = record.evidence;
  let evidence: Array<{ id: string }> | undefined;
  if (evidenceValue !== undefined) {
    if (!Array.isArray(evidenceValue) || evidenceValue.length > 12) invalidResponse();
    evidence = evidenceValue.map((item) => ({ id: asString(asRecord(item), 'id', 128) }));
  }
  const {
    providerDisplayName: _providerDisplayName,
    notes: _notes,
    ...assigned
  } = ownerOrder;
  return {
    ...assigned,
    ...(ownerDisplayName ? { ownerDisplayName } : {}),
    ...(invitation ? { invitation } : {}),
    ...(evidence ? { evidence } : {}),
  };
}

function parseProviderOrders(value: unknown): ProviderOrder[] {
  if (!Array.isArray(value) || value.length > 100) invalidResponse();
  return value.map(parseProviderOrder);
}

function parseProviderReview(value: unknown): ProviderReviewQueueItem {
  const record = asRecord(value);
  const displayName = asDisplayName(record.displayName);
  const serviceTypes = record.serviceTypes;
  if (!Array.isArray(serviceTypes) || serviceTypes.length < 1 || serviceTypes.length > 2) {
    invalidResponse();
  }
  const parsedServices = serviceTypes.map((serviceType) => {
    if (typeof serviceType !== 'string' || !SERVICE_TYPES.includes(serviceType as ServiceType)) {
      invalidResponse();
    }
    return serviceType as ServiceType;
  });
  if (new Set(parsedServices).size !== parsedServices.length) invalidResponse();
  const radiusKm = record.radiusKm;
  if (typeof radiusKm !== 'number' || !Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 30) {
    invalidResponse();
  }
  const serviceZone = asString(record, 'serviceZone', 50);
  if (!DISTRICTS.has(serviceZone)) invalidResponse();
  return {
    id: asString(record, 'id', 128), displayName,
    reviewStatus: asEnum(record, 'reviewStatus', REVIEW_STATUSES),
    serviceTypes: parsedServices,
    catExperienceMonths: asInteger(record, 'catExperienceMonths', 1200),
    dogExperienceMonths: asInteger(record, 'dogExperienceMonths', 1200),
    serviceZone, radiusKm, createdAt: asDate(record, 'createdAt'),
  };
}

function parseProviderReviews(value: unknown): ProviderReviewQueueItem[] {
  if (!Array.isArray(value) || value.length > 100) invalidResponse();
  return value.map(parseProviderReview);
}

function parseAssignedAddress(value: unknown): AssignedAddress {
  const record = asRecord(value);
  rejectCredentialFields(record);
  return { ...parsePilotLocation(record), detail: asString(record, 'detail', 300) };
}

function assertUploadUrl(uploadUrl: string): void {
  if (/^\/(?!\/)/.test(uploadUrl)) {
    if (/[\\%#\s\u0000-\u001f\u007f]/.test(uploadUrl)) invalidResponse();
    try {
      const parsed = new URL(uploadUrl, 'https://pilot.invalid');
      if (
        parsed.origin !== 'https://pilot.invalid'
        || uploadUrl !== `${parsed.pathname}${parsed.search}`
      ) invalidResponse();
      return;
    } catch {
      invalidResponse();
    }
  }
  if (/[\\\s\u0000-\u001f\u007f]/.test(uploadUrl)) invalidResponse();
  try {
    const parsed = new URL(uploadUrl);
    if (
      parsed.protocol !== 'https:'
      || parsed.username !== ''
      || parsed.password !== ''
      || parsed.hash !== ''
      || parsed.href !== uploadUrl
    ) invalidResponse();
  } catch {
    invalidResponse();
  }
}

function parseUploadHeaders(value: unknown): NonNullable<EvidenceUpload['uploadHeaders']> {
  const record = asRecord(value);
  const checksum = asString(record, 'x-amz-checksum-sha256', 44);
  if (Object.keys(record).length !== 1 || !/^[A-Za-z0-9+/]{43}=$/.test(checksum)) invalidResponse();
  return { 'x-amz-checksum-sha256': checksum };
}

function parseEvidenceUpload(value: unknown): EvidenceUpload {
  const record = asRecord(value);
  const uploadUrl = asString(record, 'uploadUrl', 2048);
  assertUploadUrl(uploadUrl);
  const expiresInSeconds = asInteger(record, 'expiresInSeconds', 3600);
  if (expiresInSeconds < 1) invalidResponse();
  return {
    objectKey: asString(record, 'objectKey', 500),
    uploadUrl,
    expiresInSeconds,
    ...(record.uploadHeaders !== undefined ? { uploadHeaders: parseUploadHeaders(record.uploadHeaders) } : {}),
  };
}

function parseEvidenceRead(value: unknown): EvidenceRead {
  const record = asRecord(value);
  const url = asString(record, 'url', 2048);
  assertUploadUrl(url);
  const expiresInSeconds = asInteger(record, 'expiresInSeconds', 3600);
  if (expiresInSeconds < 1) invalidResponse();
  return { url, expiresInSeconds };
}

function parseOwnerConfirmation(value: unknown, orderId: string): OwnerConfirmation {
  const record = asRecord(value);
  const expectedKeys = ['confirmedAt', 'orderId', 'status'];
  if (Object.keys(record).sort().join(',') !== expectedKeys.join(',')) invalidResponse();
  if (asString(record, 'orderId', 128) !== orderId) invalidResponse();
  return {
    orderId, status: asEnum(record, 'status', ['COMPLETED'] as const),
    confirmedAt: asDate(record, 'confirmedAt'),
  };
}

function parseCheckIn(value: unknown) {
  const record = asRecord(value);
  return {
    id: asString(record, 'id', 128), orderId: asString(record, 'orderId', 128),
    checkedInAt: asDate(record, 'checkedInAt'),
  };
}

function parseSubmittedReport(value: unknown) {
  const record = asRecord(value);
  return {
    id: asString(record, 'id', 128), orderId: asString(record, 'orderId', 128),
    submittedAt: asDate(record, 'submittedAt'),
  };
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

function parseOwnerRecoveryCredential(value: unknown): OwnerRecoveryCredential {
  const record = asRecord(value);
  if (!hasExactKeys(record, ['userId', 'token', 'recoveryPath'])) invalidResponse();
  const userId = asUuid(record.userId);
  const token = asString(record, 'token', 43);
  const recoveryPath = asString(record, 'recoveryPath', 128);
  if (!RECOVERY_TOKEN_PATTERN.test(token) || recoveryPath !== `/#/orders/access/${token}` || recoveryPath.includes('?')) {
    invalidResponse();
  }
  return { userId, token, recoveryPath };
}

function parseStaffSessionCreated(value: unknown): StaffSessionCreated {
  const record = asRecord(value);
  rejectCredentialFields(record);
  if (!hasExactKeys(record, ['expiresAt', 'mustChangePassword']) || typeof record.mustChangePassword !== 'boolean') {
    invalidResponse();
  }
  return { expiresAt: asDate(record, 'expiresAt'), mustChangePassword: record.mustChangePassword };
}

function parseStaffAccount(value: unknown): StaffAccount {
  const record = asRecord(value);
  rejectCredentialFields(record);
  if (!hasExactKeys(record, ['userId', 'username', 'displayName', 'role', 'mustChangePassword', 'disabledAt', 'createdAt'])) {
    invalidResponse();
  }
  const disabledAt = record.disabledAt;
  if (disabledAt !== null && (typeof disabledAt !== 'string' || !isStrictIsoTimestamp(disabledAt))) invalidResponse();
  if (typeof record.mustChangePassword !== 'boolean') invalidResponse();
  const username = asString(record, 'username', 64);
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) invalidResponse();
  return {
    userId: asUuid(record.userId), username, displayName: asDisplayName(record.displayName),
    role: asEnum(record, 'role', ['PROVIDER'] as const), mustChangePassword: record.mustChangePassword,
    disabledAt, createdAt: asDate(record, 'createdAt'),
  };
}

function parseStaffAccounts(value: unknown): StaffAccount[] {
  if (!Array.isArray(value) || value.length > 100) invalidResponse();
  return value.map(parseStaffAccount);
}

function parseMessage(value: unknown, expectedOrderId?: string): OrderMessage {
  const record = asRecord(value);
  rejectCredentialFields(record);
  if (!hasExactKeys(record, ['id', 'orderId', 'authorRole', 'body', 'createdAt'])) invalidResponse();
  const orderId = asUuid(record.orderId);
  if (expectedOrderId !== undefined && orderId !== expectedOrderId) invalidResponse();
  const body = record.body;
  if (typeof body !== 'string' || body !== body.trim() || [...body].length < 1 || [...body].length > 500) invalidResponse();
  return {
    id: asUuid(record.id), orderId, authorRole: asEnum(record, 'authorRole', ['OWNER', 'ADMIN'] as const),
    body, createdAt: asDate(record, 'createdAt'),
  };
}

function parseMessagePage(value: unknown, expectedOrderId: string): OrderMessagePage {
  const record = asRecord(value);
  rejectCredentialFields(record);
  const nextCursor = record.nextCursor;
  if (!hasExactKeys(record, ['items', 'nextCursor']) && !hasExactKeys(record, ['items'])) invalidResponse();
  if (!Array.isArray(record.items) || record.items.length > 50) invalidResponse();
  if (nextCursor !== undefined && (typeof nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(nextCursor))) invalidResponse();
  return { items: record.items.map((item) => parseMessage(item, expectedOrderId)), ...(nextCursor === undefined ? {} : { nextCursor }) };
}

function assertPassword(value: string): void {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) validationError();
}

function assertLoginPassword(value: string): void {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) validationError();
}

function normalizeMessageBody(value: string): string {
  if (typeof value !== 'string') validationError();
  const normalized = value.trim();
  if ([...normalized].length < 1 || [...normalized].length > 500) validationError();
  return normalized;
}

function normalizeStaffAccountInput(input: CreateStaffAccount): CreateStaffAccount {
  const record = asRecord(input);
  if (!hasExactKeys(record, ['username', 'displayName', 'temporaryPassword'])) validationError();
  const rawUsername = asString(record, 'username', 64);
  if (!/^[\x00-\x7F]+$/.test(rawUsername)) validationError();
  const username = rawUsername.toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) validationError();
  const rawDisplayName = asString(record, 'displayName', 30);
  const displayName = rawDisplayName.trim();
  if (!displayName || displayName.length > 30) validationError();
  const temporaryPassword = asString(record, 'temporaryPassword', 128);
  assertPassword(temporaryPassword);
  return { username, displayName, temporaryPassword };
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

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get('Retry-After');
  if (value === null || !/^[1-9]\d{0,5}$/.test(value)) return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds <= 86_400 ? seconds : undefined;
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
    const contentHeaders = init.body === undefined
      ? {}
      : { 'Content-Type': 'application/json' };
    let response: Response;
    try {
      response = await fetcher(`/api${path}`, {
        ...init,
        credentials: 'same-origin',
        headers: {
          ...contentHeaders,
          ...writeHeaders,
          ...init.headers,
        },
      });
    } catch {
      throw new PilotApiError(503, 'SERVICE_UNAVAILABLE');
    }
    if (!response.ok) throw new PilotApiError(response.status, await safeErrorCode(response), retryAfterSeconds(response));
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
    ensureOwnerSession: async () => parseSessionCreated(await request(
      '/v1/public/owner-sessions', { method: 'POST', body: JSON.stringify({}) }, [200, 201],
    )),
    issueRecoveryCredential: async () => parseOwnerRecoveryCredential(await request(
      '/v1/public/owner-recovery-credentials', { method: 'POST', body: JSON.stringify({}) }, 201,
    )),
    rotateRecoveryCredential: async () => parseOwnerRecoveryCredential(await request(
      '/v1/public/owner-recovery-credentials/rotate', { method: 'POST', body: JSON.stringify({}) }, 200,
    )),
    recoverOwnerSession: async (token) => {
      if (!RECOVERY_TOKEN_PATTERN.test(token)) validationError();
      return parseSessionCreated(await request(
        '/v1/public/owner-recovery-sessions', { method: 'POST', body: JSON.stringify({ token }) }, 201,
      ));
    },
    createStaffSession: async (username, password) => {
      if (typeof username !== 'string' || username.length < 1 || username.length > 256) validationError();
      assertLoginPassword(password);
      return parseStaffSessionCreated(await request(
        '/v1/staff/sessions', { method: 'POST', body: JSON.stringify({ username, password }) }, 201,
      ));
    },
    changeStaffPassword: async (password) => {
      assertPassword(password);
      return parseStaffSessionCreated(await request(
        '/v1/staff/password', { method: 'PATCH', body: JSON.stringify({ password }) }, 200,
      ));
    },
    listStaffAccounts: async () => parseStaffAccounts(await request('/v1/admin/staff-accounts')),
    createStaffAccount: async (input) => {
      const normalized = normalizeStaffAccountInput(input);
      return parseStaffAccount(await request('/v1/admin/staff-accounts', { method: 'POST', body: JSON.stringify(normalized) }, 201));
    },
    updateStaffAccount: async (userId, input) => {
      assertUuid(userId);
      const record = asRecord(input);
      if (!hasExactKeys(record, ['disabled']) || typeof record.disabled !== 'boolean') validationError();
      return parseStaffAccount(await request(
        `/v1/admin/staff-accounts/${encodeURIComponent(userId)}`,
        { method: 'PATCH', body: JSON.stringify(input) },
      ));
    },
    resetStaffPassword: async (userId, temporaryPassword) => {
      assertUuid(userId); assertPassword(temporaryPassword);
      await request(`/v1/admin/staff-accounts/${encodeURIComponent(userId)}/reset-password`, {
        method: 'POST', body: JSON.stringify({ temporaryPassword }),
      }, 204);
    },
    listOrderMessages: async (orderId, cursor) => {
      assertUuid(orderId);
      if (cursor !== undefined && (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(cursor))) validationError();
      const query = cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`;
      return parseMessagePage(await request(`/v1/pilot/orders/${encodeURIComponent(orderId)}/messages${query}`), orderId.toLowerCase());
    },
    sendOrderMessage: async (orderId, body) => {
      assertUuid(orderId);
      const normalizedBody = normalizeMessageBody(body);
      return parseMessage(await request(
        `/v1/pilot/orders/${encodeURIComponent(orderId)}/messages`, { method: 'POST', body: JSON.stringify({ body: normalizedBody }) }, 201,
      ), orderId.toLowerCase());
    },
    getCatalog: async () => parsePublicCatalog(await request('/v1/catalog')),
    getAdminCatalog: async () => parseAdminCatalog(await request('/v1/pilot/admin/catalog')),
    updateAdminCatalog: async (input) => parseAdminCatalog(await request(
      '/v1/pilot/admin/catalog',
      { method: 'PUT', body: JSON.stringify(input) },
    )),
    getSession: async () => parseSession(await request('/v1/pilot/session')),
    createSession: async (inviteCode) => parseSessionCreated(await request(
      '/v1/pilot/sessions',
      { method: 'POST', body: JSON.stringify({ inviteCode }) },
      201,
    )),
    createLocalSession: async (role) => parseSessionCreated(await request(
      '/v1/pilot/local-sessions',
      { method: 'POST', body: JSON.stringify({ role }) },
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
    confirmOrder: async (orderId) => parseOwnerConfirmation(await request(
      `/v1/orders/${encodeURIComponent(orderId)}/confirm`, { method: 'POST' },
    ), orderId),
    getEvidenceReadUrl: async (evidenceId) => parseEvidenceRead(await request(
      `/v1/evidence/${encodeURIComponent(evidenceId)}/read-url`,
    )),
    listAdminOrders: async () => parseAdminOrders(await request('/v1/pilot/orders')),
    listProviderOrders: async () => parseProviderOrders(await request('/v1/pilot/orders')),
    listProviderReviewQueue: async () => parseProviderReviews(
      await request('/v1/pilot/providers/review-queue'),
    ),
    reviewProvider: async (profileId, status) => {
      const record = asRecord(await request(
        `/v1/providers/${encodeURIComponent(profileId)}/review`,
        { method: 'POST', body: JSON.stringify({ status }) },
      ));
      if (asString(record, 'id', 128) !== profileId) invalidResponse();
      asEnum(record, 'reviewStatus', REVIEW_STATUSES);
    },
    confirmManualFee: async (orderId, idempotencyKey) => {
      const record = asRecord(await request(
        `/v1/pilot/orders/${encodeURIComponent(orderId)}/manual-fee-confirmation`,
        { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } },
      ));
      if (
        asString(record, 'orderId', 128) !== orderId
        || asEnum(record, 'provider', ['pilot-manual'] as const) !== 'pilot-manual'
        || asEnum(record, 'status', ['SUCCEEDED'] as const) !== 'SUCCEEDED'
      ) invalidResponse();
      asString(record, 'id', 128);
      asInteger(record, 'amountFen');
      asEnum(record, 'currency', ['CNY'] as const);
    },
    startDispatch: async (orderId) => {
      const value = await request(
        `/v1/dispatch/${encodeURIComponent(orderId)}/start`, { method: 'POST' },
      );
      if (!Array.isArray(value) || value.length > 3) invalidResponse();
      for (const invitation of value) {
        const record = asRecord(invitation);
        asString(record, 'id', 128);
        asEnum(record, 'status', INVITATION_STATUSES);
        asDate(record, 'expiresAt');
      }
    },
    applyProvider: async (input) => {
      const record = asRecord(await request(
        '/v1/providers/applications',
        { method: 'POST', body: JSON.stringify(input) },
        201,
      ));
      asString(record, 'id', 128);
      asEnum(record, 'reviewStatus', REVIEW_STATUSES);
    },
    setProviderAvailability: async (input) => {
      const record = asRecord(await request(
        '/v1/providers/availability',
        { method: 'POST', body: JSON.stringify(input) },
        201,
      ));
      asString(record, 'id', 128);
      asDate(record, 'startsAt');
      asDate(record, 'endsAt');
    },
    acceptInvitation: async (invitationId) => {
      const record = asRecord(await request(
        `/v1/invitations/${encodeURIComponent(invitationId)}/accept`, { method: 'POST' },
      ));
      asString(record, 'id', 128);
      asEnum(record, 'status', ORDER_STATUSES);
    },
    getAssignedAddress: async (orderId) => parseAssignedAddress(await request(
      `/v1/orders/${encodeURIComponent(orderId)}/address/assigned`,
    )),
    checkIn: async (orderId, beforeState) => parseCheckIn(await request(
      `/v1/pilot/orders/${encodeURIComponent(orderId)}/check-in`,
      { method: 'POST', body: JSON.stringify({ beforeState }) },
      201,
    )),
    issueEvidenceUpload: async (orderId, media) => parseEvidenceUpload(await request(
      `/v1/orders/${encodeURIComponent(orderId)}/evidence/uploads`,
      { method: 'POST', body: JSON.stringify(media) },
    )),
    uploadEvidence: async (uploadUrl, bytes, mimeType, uploadHeaders) => {
      if (!IMAGE_MIME_TYPES.includes(mimeType as typeof IMAGE_MIME_TYPES[number])) {
        throw new PilotApiError(400, 'MEDIA_TYPE_NOT_ALLOWED');
      }
      assertUploadUrl(uploadUrl);
      const headers = uploadHeaders === undefined ? {} : parseUploadHeaders(uploadHeaders);
      let response: Response;
      try {
        response = await fetcher(uploadUrl, {
          method: 'PUT', credentials: 'omit', headers: { 'Content-Type': mimeType, ...headers },
          body: bytes as unknown as BodyInit,
        });
      } catch {
        throw new PilotApiError(503, 'SERVICE_UNAVAILABLE');
      }
      if (!response.ok) throw new PilotApiError(response.status, await safeErrorCode(response));
      if (response.status !== 200 && response.status !== 204) invalidResponse();
    },
    attachEvidence: async (orderId, input) => {
      const record = asRecord(await request(
        `/v1/orders/${encodeURIComponent(orderId)}/evidence`,
        { method: 'POST', body: JSON.stringify(input) },
        201,
      ));
      return { id: asString(record, 'id', 128) };
    },
    submitReport: async (orderId, input) => parseSubmittedReport(await request(
      `/v1/pilot/orders/${encodeURIComponent(orderId)}/report`,
      { method: 'POST', body: JSON.stringify(input) },
    )),
  };
}

export const pilotApi = createPilotApi();
