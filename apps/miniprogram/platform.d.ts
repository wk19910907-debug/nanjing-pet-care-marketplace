declare const wx: {
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
};
declare function App(options: any): void;
declare function Page(options: any): void;
declare function getApp<T = any>(): T;
