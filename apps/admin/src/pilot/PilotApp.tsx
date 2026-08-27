import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminInvitePanel } from './AdminInvitePanel.js';
import { type PilotApi, PilotApiError, pilotApi, pilotErrorMessage } from './api.js';
import { LoginPanel } from './LoginPanel.js';
import type { PilotSession } from './models.js';
import { ProfilePanel } from './ProfilePanel.js';

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
    const remaining = Date.parse(session.expiresAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      setSession(null);
      return;
    }
    const timer = window.setTimeout(
      () => setSession(null),
      Math.min(remaining, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
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
        <span>邀请制试运营</span>
      </div>
      <div className="pilot-session-summary">
        <span>{session.displayName} · {ROLE_LABELS[session.role]}</span>
        <button className="pilot-header-logout" type="button" onClick={() => void logout()}>
          退出登录
        </button>
      </div>
    </header>
    <main className="pilot-main">
      {session.role === 'ADMIN' && <AdminInvitePanel api={api} onError={handleProtectedError}/>}
      {session.role === 'OWNER' && <section className="pilot-panel">
        <p className="pilot-kicker">宠主</p><h1>宠主工作区</h1>
        <p>订单功能将在下一阶段接入共享试运营数据。</p>
      </section>}
      {session.role === 'PROVIDER' && <section className="pilot-panel">
        <p className="pilot-kicker">服务人员</p><h1>服务人员工作区</h1>
        <p>接单与履约功能将在下一阶段接入共享试运营数据。</p>
      </section>}
    </main>
  </div>;
}
