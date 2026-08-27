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
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    if (response.status === 204) return undefined as T;
    try {
      return await response.json() as T;
    } catch {
      throw new PilotApiError(503, 'SERVICE_UNAVAILABLE');
    }
  }

  return {
    getSession: () => request<PilotSession>('/v1/pilot/session'),
    createSession: (inviteCode) => request<PilotSessionCreated>('/v1/pilot/sessions', {
      method: 'POST', body: JSON.stringify({ inviteCode }),
    }),
    updateProfile: (displayName) => request<PilotProfile>('/v1/pilot/me', {
      method: 'PATCH', body: JSON.stringify({ displayName }),
    }),
    deleteSession: () => request<void>('/v1/pilot/session', { method: 'DELETE' }),
    createInvite: (role) => request<PilotInviteCreated>('/v1/pilot/invites', {
      method: 'POST', body: JSON.stringify({ role }),
    }),
    listInvites: () => request<PilotInvite[]>('/v1/pilot/invites'),
  };
}

export const pilotApi = createPilotApi();
