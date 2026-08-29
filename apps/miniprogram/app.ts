import { createApiClient } from './services/api.js';
import { resolveApiBaseUrl } from './services/environment.js';
import { createSessionStore, createWechatLoginAdapter } from './services/session.js';

const session = createSessionStore({
  get: (key) => wx.getStorageSync(key), set: (key, value) => wx.setStorageSync(key, value),
  remove: (key) => wx.removeStorageSync(key),
});
const extConfig = wx.getExtConfigSync();
const environment = wx.getAccountInfoSync().miniProgram.envVersion;
const api = createApiClient({
  baseUrl: resolveApiBaseUrl({
    environment,
    productionBaseUrl: extConfig.apiBaseUrl ?? 'https://api.nanjing-anxinchong.invalid',
    ...(extConfig.developmentApiBaseUrl ? { developmentBaseUrl: extConfig.developmentApiBaseUrl } : {}),
  }),
  token: session.read,
  transport: (spec) => new Promise((resolve, reject) => wx.request({
    ...spec, header: spec.headers,
    success: resolve, fail: reject,
  })),
});
const login = createWechatLoginAdapter({
  wxLogin: () => new Promise((resolve, reject) => wx.login({ success: resolve, fail: reject })),
  exchange: api.createWechatSession,
  saveToken: session.save,
});

App({ globalData: { api, session, login } });
