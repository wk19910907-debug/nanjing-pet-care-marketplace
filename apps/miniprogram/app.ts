import { createApiClient } from './services/api.js';
import { createSessionStore } from './services/session.js';

const session = createSessionStore({
  get: (key) => wx.getStorageSync(key), set: (key, value) => wx.setStorageSync(key, value),
  remove: (key) => wx.removeStorageSync(key),
});
const api = createApiClient({
  baseUrl: 'https://api.petcare.example', token: session.read,
  transport: (spec) => new Promise((resolve, reject) => wx.request({
    ...spec, header: spec.headers,
    success: resolve, fail: reject,
  })),
});

App({ globalData: { api, session } });
