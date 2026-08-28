import { useCallback, useEffect, useRef, useState } from 'react';
import { type PilotApi, PilotApiError, pilotApi, pilotErrorMessage } from './api.js';
import { LoginPanel } from './LoginPanel.js';
import type { PilotSession } from './models.js';
import { OwnerPilotWorkspace } from './OwnerPilotWorkspace.js';
import { ProfilePanel } from './ProfilePanel.js';
import { AdminPilotWorkspace } from './AdminPilotWorkspace.js';
import { ProviderPilotWorkspace } from './ProviderPilotWorkspace.js';

type PilotAppProps = { api?: PilotApi };

const ROLE_LABELS = { OWNER: '宠主', PROVIDER: '服务人员', ADMIN: '平台管理员' } as const;

export function PilotApp({ api = pilotApi }: PilotAppProps) {
  const [session, setSession] = useState<PilotSession | null | undefined>(undefined);
  const [failure, setFailure] = useState('');
  const bootstrapped = useRef(false);

  const loadSession = useCallback(async () => {
    setSession(undefined);
    setFailure('');
    try {
      const current = await api.getSession();
      const expiresAt = Date.parse(current.expiresAt);
      setSession(Number.isFinite(expiresAt) && expiresAt > Date.now() ? current : null);
    } catch (caught) {
      if (caught instanceof PilotApiError && caught.status === 401) {
        setSession(null);
        return;
      }
      setFailure(pilotErrorMessage(caught));
    }
  }, [api]);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!session) return;
    let timer: number | undefined;
    const checkExpiry = () => {
      const remaining = Date.parse(session.expiresAt) - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) {
        setSession(null);
        return;
      }
      timer = window.setTimeout(checkExpiry, Math.min(remaining, 2_147_483_647));
    };
    checkExpiry();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [session]);

  const handleProtectedError = useCallback((caught: unknown): string | null => {
    if (caught instanceof PilotApiError && caught.status === 401) {
      setFailure('');
      setSession(null);
      return null;
    }
    return pilotErrorMessage(caught);
  }, []);

  const logout = async () => {
    setFailure('');
    try {
      await api.deleteSession();
    } catch (caught) {
      if (!(caught instanceof PilotApiError && caught.status === 401)) {
        setFailure(pilotErrorMessage(caught));
        return;
      }
    }
    await loadSession();
  };

  if (failure) return <main className="pilot-state-page">
    <section className="pilot-state-card" role="alert">
      <h1>暂时无法连接试运营服务</h1>
      <p>{failure}</p>
      <button type="button" onClick={() => void loadSession()}>重试</button>
    </section>
  </main>;

  if (session === undefined) return <main className="pilot-state-page" aria-live="polite">
    <section className="pilot-state-card"><p>正在确认登录状态…</p></section>
  </main>;

  if (session === null) return <LoginPanel api={api} onAuthenticated={loadSession}/>;

  if (session.displayName === null) {
    return <ProfilePanel
      api={api}
      onSaved={loadSession}
      onLogout={logout}
      onError={handleProtectedError}
    />;
  }

  return <div className="pilot-shell">
    <header className="pilot-header">
      <div>
        <strong>南京安心宠</strong>
        <span>本地试运营</span>
      </div>
      <div className="pilot-session-summary">
        <span>{session.displayName} · {ROLE_LABELS[session.role]}</span>
        <button className="pilot-header-logout" type="button" onClick={() => void logout()}>
          退出登录
        </button>
      </div>
    </header>
    <main className="pilot-main">
      {session.role === 'ADMIN' && <div className="pilot-admin-stack">
        <AdminPilotWorkspace key={session.userId} api={api} onError={handleProtectedError}/>
      </div>}
      {session.role === 'OWNER' && <OwnerPilotWorkspace
        key={session.userId} api={api} displayName={session.displayName} onError={handleProtectedError}
      />}
      {session.role === 'PROVIDER' && <ProviderPilotWorkspace
        key={session.userId} api={api} displayName={session.displayName} onError={handleProtectedError}
      />}
    </main>
  </div>;
}
