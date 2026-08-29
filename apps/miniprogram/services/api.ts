import { PublicOperationsCatalogSchema } from '@pet/contracts';

export type RequestSpec = {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  data?: unknown;
};

export type RequestTransport = (request: RequestSpec) => Promise<{ statusCode: number; data: unknown }>;

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
      throw new Error(payload?.code ?? 'REQUEST_FAILED');
    }
    return response.data as T;
  }

  return {
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
    quote: (input: unknown) => request('POST', '/v1/quotes', input),
    createOrder: (input: unknown, idempotencyKey: string) =>
      request('POST', '/v1/orders', input, { 'Idempotency-Key': idempotencyKey }),
    getOrder: (orderId: string) => request('GET', `/v1/orders/${orderId}`),
    confirmOrder: (orderId: string) => request('POST', `/v1/orders/${orderId}/confirm`),
    cancelOrder: (orderId: string, reason: string) => request('POST', `/v1/orders/${orderId}/cancel`, { reason }),
    openDispute: (orderId: string, reason: string) => request('POST', `/v1/orders/${orderId}/disputes`, { reason }),
    applyProvider: (input: unknown) => request('POST', '/v1/providers/applications', input),
    setAvailability: (input: unknown) => request('POST', '/v1/providers/availability', input),
    acceptInvitation: (invitationId: string) => request('POST', `/v1/invitations/${invitationId}/accept`),
    checkIn: (orderId: string, input: unknown) => request('POST', `/v1/orders/${orderId}/check-in`, input),
    issueUpload: (orderId: string, input: unknown) => request('POST', `/v1/orders/${orderId}/evidence/uploads`, input),
    attachEvidence: (orderId: string, input: unknown) => request('POST', `/v1/orders/${orderId}/evidence`, input),
    submitReport: (orderId: string, input: unknown) => request('POST', `/v1/orders/${orderId}/report`, input),
    getEarnings: () => request('GET', '/v1/providers/me/settlements'),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
