declare module 'core-js-pure/actual/url/index.js' {
  const URLConstructor: typeof URL;
  export default URLConstructor;
}

declare const wx: {
  chooseMedia: import('./services/evidence.js').MediaPlatform['chooseMedia'];
  getFileSystemManager: import('./services/evidence.js').MediaPlatform['getFileSystemManager'];
  request(options: Record<string, unknown>): void;
  requestPayment(options: Record<string, unknown>): void;
  getStorageSync(key: string): string | undefined;
  setStorageSync(key: string, value: string): void;
  removeStorageSync(key: string): void;
  showToast(options: Record<string, unknown>): void;
  login(options: {
    success(result: { code: string; errMsg: string }): void;
    fail(error: unknown): void;
  }): void;
  getAccountInfoSync(): { miniProgram: { envVersion: 'develop' | 'trial' | 'release' } };
  getExtConfigSync(): { apiBaseUrl?: string; developmentApiBaseUrl?: string };
  navigateTo(options: { url: string }): void;
};
declare function App(options: any): void;
declare function Page(options: any): void;
declare function getApp<T = any>(): T;
