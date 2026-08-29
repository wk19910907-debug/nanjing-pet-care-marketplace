export type KeyValueStorage = {
  get(key: string): string | undefined;
  set(key: string, value: string): unknown;
  remove(key: string): unknown;
};

const SESSION_KEY = 'petcare.session';

export function createSessionStore(storage: KeyValueStorage) {
  return {
    read: () => storage.get(SESSION_KEY) ?? null,
    save: (opaqueToken: string) => storage.set(SESSION_KEY, opaqueToken),
    clear: () => storage.remove(SESSION_KEY),
  };
}

export function createWechatLoginAdapter(dependencies: {
  wxLogin: () => Promise<{ code: string; errMsg?: string }>;
  exchange: (input: { code: string }) => Promise<{ token: string; expiresAt: string }>;
  saveToken: (token: string) => unknown;
}) {
  return async () => {
    const result = await dependencies.wxLogin();
    if (typeof result.code !== 'string' || result.code.length === 0) throw new Error('WECHAT_LOGIN_FAILED');
    const session = await dependencies.exchange({ code: result.code });
    dependencies.saveToken(session.token);
    return { expiresAt: session.expiresAt };
  };
}
