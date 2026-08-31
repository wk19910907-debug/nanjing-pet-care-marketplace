import { ApiError } from './api.js';
import type { AccountSession } from './account-models.js';

type Role = 'OWNER' | 'PROVIDER';
export function createAccountAccess(deps: {
  getSession(): Promise<AccountSession>; login(role: Role): Promise<unknown>;
  saveDisplayName(name: string): Promise<void>; clear(): unknown; development: boolean;
}) {
  let pending: { role: Role; kind: 'load' | 'save'; promise: Promise<AccountSession> } | null = null;
  async function read() {
    const current = await deps.getSession();
    if (!(Date.parse(current.expiresAt) > Date.now())) throw new ApiError(401, 'UNAUTHENTICATED');
    return current;
  }
  async function load(role: Role) {
    let current: AccountSession;
    let loggedIn = false;
    try { current = await read(); }
    catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      deps.clear(); await deps.login(role); loggedIn = true; current = await read();
    }
    if (current.role !== role && deps.development && !loggedIn) {
      deps.clear(); await deps.login(role); current = await read();
    }
    if (current.role !== role) throw new Error('ACCOUNT_ROLE_MISMATCH');
    return current;
  }
  return {
    load(role: Role): Promise<AccountSession> {
      if (pending) return pending.role === role && pending.kind === 'load' ? pending.promise : Promise.reject(new Error('ACCOUNT_BUSY'));
      const promise = load(role).finally(() => { pending = null; });
      pending = { role, kind: 'load', promise }; return promise;
    },
    save(role: Role, name: string): Promise<AccountSession> {
      if (pending) return Promise.reject(new Error('ACCOUNT_BUSY'));
      const promise = (async () => {
        const before = await load(role);
        await deps.saveDisplayName(name);
        const after = await read();
        if (after.userId !== before.userId || after.role !== role || after.displayName !== name.trim()) throw new Error('PROFILE_NOT_CONFIRMED');
        return after;
      })().finally(() => { pending = null; });
      pending = { role, kind: 'save', promise }; return promise;
    },
  };
}
