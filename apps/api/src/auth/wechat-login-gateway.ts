import { z } from 'zod';

export type WechatLoginCredentials = { appId: string; appSecret: string };
export const WechatIdentitySchema = z.object({
  appId: z.string().regex(/^wx[a-fA-F0-9]{16}$/),
  openId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
});
export type WechatIdentity = z.infer<typeof WechatIdentitySchema>;
const ExchangeSchema = z.object({
  openid: WechatIdentitySchema.shape.openId,
  session_key: z.string().min(1).max(256),
  errcode: z.literal(0).optional(),
});
const MAX_RESPONSE_BYTES = 16_384;

/** No retry: a code is single-use. Never log the URL or the upstream response. */
export class WechatLoginGateway {
  constructor(
    private readonly credentials: WechatLoginCredentials,
    private readonly transport: typeof fetch = fetch,
  ) {}

  async exchange(code: string): Promise<WechatIdentity> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    let response: Response | undefined;
    try {
      const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
      url.search = new URLSearchParams({
        appid: this.credentials.appId, secret: this.credentials.appSecret,
        js_code: code, grant_type: 'authorization_code',
      }).toString();
      response = await this.transport(url, {
        method: 'GET', redirect: 'error', signal: controller.signal,
      });
      if (!response.ok || !response.body
        || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
        throw new Error('WECHAT_LOGIN_UNAVAILABLE');
      }
      const reader = response.body.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_RESPONSE_BYTES) throw new Error('WECHAT_LOGIN_UNAVAILABLE');
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const error = z.object({ errcode: z.number() }).safeParse(payload);
      if (error.success && [40029, 40163].includes(error.data.errcode)) {
        throw new Error('WECHAT_CODE_INVALID');
      }
      const parsed = ExchangeSchema.safeParse(payload);
      if (!parsed.success) throw new Error('WECHAT_LOGIN_UNAVAILABLE');
      return { appId: this.credentials.appId, openId: parsed.data.openid };
    } catch (error) {
      // Do not attach a cause: fetch errors can include the secret-bearing URL.
      throw new Error(error instanceof Error && error.message === 'WECHAT_CODE_INVALID'
        ? 'WECHAT_CODE_INVALID' : 'WECHAT_LOGIN_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      controller.abort();
      await response?.body?.cancel().catch(() => undefined);
    }
  }
}
