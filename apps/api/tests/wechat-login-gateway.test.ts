import { afterEach, describe, expect, it, vi } from 'vitest';
import { WechatLoginGateway } from '../src/auth/wechat-login-gateway.js';

const credentials = { appId: 'wx1234567890abcdef', appSecret: 'a'.repeat(32) };
const openId = 'openid-from-wechat';
const success = { openid: openId, session_key: 'private-key', unionid: 'private-union' };

afterEach(() => vi.useRealTimers());

describe('WechatLoginGateway', () => {
  it('exchanges only against the fixed HTTPS API and returns only the verified identity', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(success));
    const gateway = new WechatLoginGateway(credentials, transport);
    expect(await gateway.exchange('one-time-code')).toEqual({ appId: credentials.appId, openId });
    const [target, options] = transport.mock.calls[0]!;
    const url = new URL(String(target));
    expect(url.origin + url.pathname).toBe('https://api.weixin.qq.com/sns/jscode2session');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      appid: credentials.appId, secret: credentials.appSecret,
      js_code: 'one-time-code', grant_type: 'authorization_code',
    });
    expect(options).toMatchObject({ method: 'GET', redirect: 'error', signal: expect.any(AbortSignal) });
  });

  it.each([40029, 40163])('rejects invalid or consumed code (%s) without replay fallback', async (errcode) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ errcode, errmsg: 'secret detail' }));
    await expect(new WechatLoginGateway(credentials, transport).exchange('code'))
      .rejects.toThrow('WECHAT_CODE_INVALID');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    { errcode: -1, errmsg: 'secret detail' }, { errcode: 45011 },
    { errcode: 0 }, { openid: '' }, { openid: openId },
    { ...success, errcode: 40013 }, { ...success, openid: 'x'.repeat(129) },
    { ...success, openid: 'bad\u0000id' }, null, [],
  ])('fails closed on malformed or failed exchange %j', async (payload) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    await expect(new WechatLoginGateway(credentials, transport).exchange('code'))
      .rejects.toThrow('WECHAT_LOGIN_UNAVAILABLE');
  });

  it('does not expose transport URLs or secrets', async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error('https://secret?code=private'));
    const result = new WechatLoginGateway(credentials, transport).exchange('code');
    await expect(result).rejects.toEqual(new Error('WECHAT_LOGIN_UNAVAILABLE'));
  });

  it.each([
    () => new Response('server secret', { status: 500 }),
    () => new Response('not JSON'),
    () => new Response('x'.repeat(16_385)),
    () => new Response('{}', { headers: { 'content-length': '9999999' } }),
  ])('rejects non-success and oversized responses', async (response) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response());
    await expect(new WechatLoginGateway(credentials, transport).exchange('code'))
      .rejects.toThrow('WECHAT_LOGIN_UNAVAILABLE');
  });

  it('bounds response-body wait time', async () => {
    vi.useFakeTimers();
    const transport = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      return new Response(new ReadableStream({
        start(controller) {
          options?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
        },
      }));
    });
    const promise = new WechatLoginGateway(credentials, transport).exchange('code');
    const assertion = expect(promise).rejects.toThrow('WECHAT_LOGIN_UNAVAILABLE');
    await vi.advanceTimersByTimeAsync(5_001);
    await assertion;
  });

  it('aborts while waiting for response headers without retrying or exposing transport details', async () => {
    vi.useFakeTimers();
    const transport = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('private transport URL')));
    }));
    const promise = new WechatLoginGateway(credentials, transport).exchange('code');
    const assertion = expect(promise).rejects.toEqual(new Error('WECHAT_LOGIN_UNAVAILABLE'));
    await vi.advanceTimersByTimeAsync(5_001);
    await assertion;
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
