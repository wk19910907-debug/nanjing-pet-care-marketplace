import type { RequestTransport } from './api.js';

type WxRequest = { request(options: Record<string, unknown>): void };
export function createWxTransport(platform: WxRequest, baseUrl: string, localCookies: boolean): RequestTransport {
  let cookie = '';
  const allowLocal = localCookies && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(baseUrl);
  return (spec) => new Promise((resolve, reject) => {
    const apiRequest = spec.method !== 'PUT' && spec.url.startsWith(`${baseUrl}/api/`);
    platform.request({ url: spec.url, method: spec.method, data: spec.data,
      header: { ...spec.headers, ...(allowLocal && apiRequest && cookie ? { Cookie: cookie } : {}) },
      timeout: 30_000,
      success: (response: { statusCode: number; data: unknown; cookies?: string[] }) => {
        if (allowLocal && apiRequest && spec.url === `${baseUrl}/api/v1/pilot/local-sessions`
          && response.statusCode === 201) {
          cookie = response.cookies?.map((value) => value.split(';')[0]!)
            .find((value) => /^petcare_pilot_session=[A-Za-z0-9_-]+$/.test(value)) ?? '';
        }
        resolve({ statusCode: response.statusCode, data: response.data });
      },
      fail: () => reject(new Error('NETWORK_UNAVAILABLE')),
    });
  });
}
