import { PublicOperationsCatalogSchema } from '@pet/contracts';
import { parseAccountSession } from './account-models.js';
import { parseServiceOrder, parseUpload, uploadUrl, type UploadCapability } from './fulfillment-models.js';

export type RequestSpec = {
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  headers: Record<string, string>;
  data?: unknown;
};

export type RequestTransport = (request: RequestSpec) => Promise<{ statusCode: number; data: unknown }>;

export class ApiError extends Error {
  constructor(public readonly status: number, code: string) { super(code); }
}

export function createApiClient(config: {
  baseUrl: string;
  token: () => string | null;
  transport: RequestTransport;
}) {
  async function request<T>(method: 'GET' | 'POST', path: string, data?: unknown, headers = {}, authenticated = true): Promise<T> {
    const token = authenticated ? config.token() : null;
    const response = await config.transport({
      method, url: `${config.baseUrl}${path}`, data,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      const payload = response.data as { code?: string } | null;
      throw new ApiError(response.statusCode, typeof payload?.code === 'string' ? payload.code : 'REQUEST_FAILED');
    }
    return response.data as T;
  }

  return {
    getSession: async () => parseAccountSession(await request('GET', '/api/v1/pilot/session')),
    saveDisplayName: async (name: string) => {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 30) throw new Error('DISPLAY_NAME_INVALID');
      await request('POST', '/api/v1/pilot/me', { displayName: name.trim() });
    },
    getCatalog: async () => PublicOperationsCatalogSchema.parse(
      await request('GET', '/api/v1/catalog', undefined, {}, false),
    ),
    createWechatSession: async (input: { code: string }) => {
      const response = await request<unknown>('POST', '/api/v1/auth/wechat/session', input, {}, false);
      if (!response || typeof response !== 'object') throw new Error('INVALID_SESSION_RESPONSE');
      const { token, expiresAt } = response as Record<string, unknown>;
      if (typeof token !== 'string' || token.length < 1 || typeof expiresAt !== 'string') {
        throw new Error('INVALID_SESSION_RESPONSE');
      }
      return { token, expiresAt };
    },
    createLocalOwnerSession: () => request<{ expiresAt: string }>(
      'POST', '/api/v1/pilot/local-sessions', { role: 'OWNER' }, {}, false,
    ),
    createLocalProviderSession: () => request<{ expiresAt: string }>(
      'POST', '/api/v1/pilot/local-sessions', { role: 'PROVIDER' }, {}, false,
    ),
    quote: (input: unknown) => request('POST', '/api/v1/quotes', input),
    listPets: () => request<Array<{ id: string; name: string; species: 'CAT' | 'DOG' }>>('GET', '/api/v1/pets'),
    listAddresses: () => request<Array<{ id: string; city: string; district: string; serviceZone: string }>>('GET', '/api/v1/addresses'),
    createOrder: (input: unknown, idempotencyKey: string) =>
      request('POST', '/api/v1/orders', input, { 'Idempotency-Key': idempotencyKey }),
    getOrder: (orderId: string) => request('GET', `/api/v1/orders/${orderId}`),
    confirmOrder: (orderId: string) => request('POST', `/api/v1/orders/${orderId}/confirm`),
    cancelOrder: (orderId: string, reason: string) => request('POST', `/api/v1/orders/${orderId}/cancel`, { reason }),
    openDispute: (orderId: string, reason: string) => request('POST', `/api/v1/orders/${orderId}/disputes`, { reason }),
    applyProvider: (input: unknown) => request('POST', '/api/v1/providers/applications', input),
    setAvailability: (input: unknown) => request('POST', '/api/v1/providers/availability', input),
    acceptInvitation: (invitationId: string) => request('POST', `/api/v1/invitations/${invitationId}/accept`),
    getServiceOrder: async (orderId: string) => parseServiceOrder(
      await request('GET', `/api/v1/pilot/orders/${encodeURIComponent(orderId)}`), orderId,
    ),
    listProviderTasks: () => request<unknown[]>('GET', '/api/v1/pilot/orders'),
    checkIn: (orderId: string, input: { beforeState: Record<string, unknown> }) => request('POST', `/api/v1/pilot/orders/${encodeURIComponent(orderId)}/check-in`, { beforeState: input.beforeState }),
    issueUpload: async (orderId: string, input: unknown) => parseUpload(
      await request('POST', `/api/v1/orders/${encodeURIComponent(orderId)}/evidence/uploads`, input), config.baseUrl,
    ),
    uploadEvidence: async (capability: UploadCapability, bytes: ArrayBuffer, mimeType: string) => {
      const issued = parseUpload(capability, config.baseUrl);
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 1 || bytes.byteLength > 20 * 1024 * 1024
        || !['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw new Error('MEDIA_TYPE_NOT_ALLOWED');
      const response = await config.transport({ method: 'PUT', url: uploadUrl(issued.uploadUrl, config.baseUrl),
        data: bytes, headers: { 'Content-Type': mimeType, ...issued.uploadHeaders } });
      if (response.statusCode !== 200 && response.statusCode !== 204) throw new Error('EVIDENCE_UPLOAD_FAILED');
    },
    attachEvidence: (orderId: string, input: unknown) => request('POST', `/api/v1/orders/${orderId}/evidence`, input),
    submitReport: (orderId: string, input: { checklist: Record<string, unknown>; afterState: Record<string, unknown>; notes: string }) => request(
      'POST', `/api/v1/pilot/orders/${encodeURIComponent(orderId)}/report`,
      { checklist: input.checklist, afterState: input.afterState, notes: input.notes },
    ),
    getEarnings: () => request('GET', '/api/v1/providers/me/settlements'),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
