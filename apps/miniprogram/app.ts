import { createApiClient } from './services/api.js';
import { resolveApiBaseUrl } from './services/environment.js';
import { createSessionStore, createWechatLoginAdapter } from './services/session.js';
import { chooseEvidence } from './services/evidence.js';
import { createWxTransport } from './services/wx-transport.js';

const session = createSessionStore({
  get: (key) => wx.getStorageSync(key), set: (key, value) => wx.setStorageSync(key, value),
  remove: (key) => wx.removeStorageSync(key),
});
const extConfig = wx.getExtConfigSync();
const environment = wx.getAccountInfoSync().miniProgram.envVersion;
const baseUrl = resolveApiBaseUrl({
    environment,
    productionBaseUrl: extConfig.apiBaseUrl ?? 'https://api.nanjing-anxinchong.invalid',
    ...(extConfig.developmentApiBaseUrl ? { developmentBaseUrl: extConfig.developmentApiBaseUrl } : {}),
  });
const api = createApiClient({
  baseUrl,
  token: session.read,
  transport: createWxTransport(wx, baseUrl, environment === 'develop'),
});
const wechatLogin = createWechatLoginAdapter({
  wxLogin: () => new Promise((resolve, reject) => wx.login({ success: resolve, fail: reject })),
  exchange: api.createWechatSession,
  saveToken: session.save,
});
const login = environment === 'develop'
  ? (role = 'OWNER') => role === 'PROVIDER' ? api.createLocalProviderSession() : api.createLocalOwnerSession()
  : wechatLogin;

App({ globalData: { api, session, login, chooseEvidence: () => chooseEvidence(wx) } });
