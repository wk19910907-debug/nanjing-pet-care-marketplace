import type {
  PilotInvite,
  PilotInviteCreated,
  PilotInviteRole,
  PilotProfile,
  PilotSession,
  PilotSessionCreated,
} from './models.js';

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
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;

const PILOT_ROLES = ['OWNER', 'PROVIDER', 'ADMIN'] as const;
const INVITE_ROLES = ['OWNER', 'PROVIDER'] as const;

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

function asDate(record: JsonRecord, key: string): string {
  const value = asString(record, key, 64);
  if (!Number.isFinite(Date.parse(value))) invalidResponse();
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
    const normalized = key.toLowerCase();
    return normalized.includes('token')
      || normalized === 'codehash'
      || normalized === 'invitecode'
      || (!allowCode && normalized === 'code');
  });
  if (unsafe) invalidResponse();
}

function parseSession(value: unknown): PilotSession {
  const record = asRecord(value);
  rejectCredentialFields(record);
  const displayName = record.displayName;
  if (displayName !== null && (typeof displayName !== 'string' || displayName.length > 30)) {
    invalidResponse();
  }
  return {
    userId: asString(record, 'userId', 128),
    role: asRole(record),
    displayName,
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
  const displayName = asString(record, 'displayName', 30);
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
    typeof consumedAt !== 'string' || !Number.isFinite(Date.parse(consumedAt))
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
    expectedStatus = 200,
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
    if (response.status !== expectedStatus) invalidResponse();
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
  };
}

export const pilotApi = createPilotApi();
