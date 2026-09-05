import { useCallback, useEffect, useRef, useState } from 'react';
import { type PilotApi, PilotApiError, pilotApi, pilotErrorMessage } from './api.js';
import type { OwnerRecoveryCredential, PilotSession } from './models.js';
import { OwnerPilotWorkspace } from './OwnerPilotWorkspace.js';
import { ProfilePanel } from './ProfilePanel.js';
import { AdminPilotWorkspace } from './AdminPilotWorkspace.js';
import { ProviderPilotWorkspace } from './ProviderPilotWorkspace.js';
import { PublicLanding } from '../demo/PublicLanding.js';
import type { PublicQuoteSelection } from '../demo/publicQuote.js';
import type { PublicOperationsCatalog } from './models.js';
import { RecoveryCredentialCard } from './RecoveryCredentialCard.js';
import { StaffLoginPanel } from './StaffLoginPanel.js';
import { StaffPasswordPanel } from './StaffPasswordPanel.js';

type PilotAppProps = { api?: PilotApi };

const ROLE_LABELS = { OWNER: '宠主', PROVIDER: '服务人员', ADMIN: '平台管理员' } as const;

export function PilotApp({ api = pilotApi }: PilotAppProps) {
  const [session, setSession] = useState<PilotSession | null | undefined>(undefined);
  const [failure, setFailure] = useState('');
  const [publicCatalog, setPublicCatalog] = useState<PublicOperationsCatalog | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [quoteSelection, setQuoteSelection] = useState<PublicQuoteSelection>({ serviceType: 'CAT_FEEDING', district: '建邺区' });
  const bootstrapped = useRef(false);
  const catalogBootstrapped = useRef(false);
  const ownerRequestInFlight = useRef(false);
  const logoutRequestInFlight = useRef(false);
  const logoutRequestVersion = useRef(0);
  const sessionVersion = useRef(0);
  const [recoveryCredential, setRecoveryCredential] = useState<OwnerRecoveryCredential | null>(null);
  const [firstOrderRecoveryDelivery, setFirstOrderRecoveryDelivery] = useState<string | null>(null);
  const [accessMode, setAccessMode] = useState<'NONE' | 'STAFF' | 'RECOVERY'>('NONE');
  const [accessError, setAccessError] = useState('');
  const [startBooking, setStartBooking] = useState(false);
  const [ownerPending, setOwnerPending] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const sessionUserId = useRef<string | null>(null);
  const recoveryRotationLock = useRef<number | null>(null);
  const recoveryRotationRequest = useRef(0);
  const recoveryRotationDisplayVersion = useRef(0);
  const recoveryFocusTimer = useRef<number | undefined>(undefined);
  const [recoveryRotating, setRecoveryRotating] = useState(false);

  const clearSessionBoundUi = useCallback(() => {
    recoveryRotationDisplayVersion.current++;
    if (recoveryFocusTimer.current !== undefined) {
      window.clearTimeout(recoveryFocusTimer.current);
      recoveryFocusTimer.current = undefined;
    }
    setRecoveryCredential(null);
    setFirstOrderRecoveryDelivery(null);
    setStartBooking(false);
    setRecoveryRotating(recoveryRotationLock.current !== null);
  }, []);

  const invalidateSession = useCallback(() => {
    sessionVersion.current++;
    sessionUserId.current = null;
    clearSessionBoundUi();
    setSession(null);
  }, [clearSessionBoundUi]);

  const loadSession = useCallback(async () => {
    const requestVersion = ++sessionVersion.current;
    setSession(undefined);
    setFailure('');
    try {
      const current = await api.getSession();
      if (requestVersion !== sessionVersion.current) return;
      const expiresAt = Date.parse(current.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        invalidateSession();
        return;
      }
      if (sessionUserId.current !== null && sessionUserId.current !== current.userId) clearSessionBoundUi();
      sessionUserId.current = current.userId;
      setSession(current);
    } catch (caught) {
      if (requestVersion !== sessionVersion.current) return;
      if (caught instanceof PilotApiError && caught.status === 401) {
        invalidateSession();
        return;
      }
      setFailure(pilotErrorMessage(caught));
    }
  }, [api, clearSessionBoundUi, invalidateSession]);

  const loadCatalog = useCallback(async () => {
    setCatalogFailed(false);
    setPublicCatalog(null);
    try {
      setPublicCatalog(await api.getCatalog());
    } catch {
      setCatalogFailed(true);
    }
  }, [api]);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    const match = /^#\/orders\/access\/([A-Za-z0-9_-]{43})$/.exec(window.location.hash);
    if (!match) { void loadSession(); return; }
    const token = match[1]!;
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    void (async () => {
      try {
        await api.recoverOwnerSession(token);
        await loadSession();
      } catch (caught) {
        setAccessMode('RECOVERY');
        setAccessError(pilotErrorMessage(caught));
        invalidateSession();
      }
    })();
  }, [api, invalidateSession, loadSession]);

  useEffect(() => {
    if (catalogBootstrapped.current) return;
    catalogBootstrapped.current = true;
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (!session) return;
    let timer: number | undefined;
    const checkExpiry = () => {
      const remaining = Date.parse(session.expiresAt) - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) {
        invalidateSession();
        return;
      }
      timer = window.setTimeout(checkExpiry, Math.min(remaining, 2_147_483_647));
    };
    checkExpiry();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [invalidateSession, session]);

  const handleProtectedError = useCallback((caught: unknown): string | null => {
    if (caught instanceof PilotApiError && caught.status === 401) {
      setFailure('');
      invalidateSession();
      return null;
    }
    return pilotErrorMessage(caught);
  }, [invalidateSession]);

  const logout = async () => {
    if (logoutRequestInFlight.current) return;
    const requestVersion = ++logoutRequestVersion.current;
    logoutRequestInFlight.current = true;
    setLogoutPending(true);
    setFailure('');
    invalidateSession();
    try {
      await api.deleteSession();
    } catch {
      // Reconcile the cookie state below even if the network response was lost.
    }
    try {
      if (requestVersion !== logoutRequestVersion.current) return;
      await loadSession();
    } finally {
      if (requestVersion === logoutRequestVersion.current) {
        logoutRequestInFlight.current = false;
        setLogoutPending(false);
      }
    }
  };

  const startOwnerSession = async () => {
    if (logoutRequestInFlight.current || ownerRequestInFlight.current) return;
    ownerRequestInFlight.current = true;
    setOwnerPending(true);
    setAccessError('');
    setStartBooking(true);
    try {
      await api.ensureOwnerSession();
      await loadSession();
    } catch (caught) {
      setAccessError(pilotErrorMessage(caught));
    } finally { ownerRequestInFlight.current = false; setOwnerPending(false); }
  };

  const recover = async (token: string) => {
    if (logoutRequestInFlight.current) return;
    invalidateSession();
    setAccessError('');
    try { await api.recoverOwnerSession(token); setAccessMode('NONE'); await loadSession(); }
    catch (caught) { setAccessError(pilotErrorMessage(caught)); }
  };

  const issueReplacementRecovery = async () => {
    if (logoutRequestInFlight.current || recoveryRotationLock.current !== null) return;
    const requestId = ++recoveryRotationRequest.current;
    recoveryRotationLock.current = requestId;
    const displayVersion = ++recoveryRotationDisplayVersion.current;
    setRecoveryRotating(true);
    try {
      const credential = await api.rotateRecoveryCredential();
      if (displayVersion !== recoveryRotationDisplayVersion.current) return;
      setRecoveryCredential(credential);
    } catch (caught) {
      if (displayVersion === recoveryRotationDisplayVersion.current) setFailure(pilotErrorMessage(caught));
    } finally {
      if (recoveryRotationLock.current === requestId) {
        recoveryRotationLock.current = null;
        setRecoveryRotating(false);
      }
    }
  };

  const closeRecoveryCredential = () => {
    setRecoveryCredential(null);
    recoveryFocusTimer.current = window.setTimeout(() => {
      recoveryFocusTimer.current = undefined;
      const target = document.querySelector<HTMLElement>('[data-access-return-focus]');
      if (target?.isConnected) target.focus();
    }, 0);
  };

  if (logoutPending) return <main className="pilot-state-page" aria-live="polite">
    <section className="pilot-state-card" role="status">
      <h1>正在安全退出</h1>
      <p>正在清除本次登录状态，请稍候。</p>
    </section>
  </main>;

  if (failure) return <main className="pilot-state-page">
    <section className="pilot-state-card" role="alert">
      <h1>暂时无法连接服务</h1>
      <p>{failure}</p>
      <button type="button" onClick={() => void loadSession()}>重试</button>
    </section>
  </main>;

  if (session === undefined) return <main className="pilot-state-page" aria-live="polite">
    <section className="pilot-state-card"><p>正在确认登录状态…</p></section>
  </main>;

  if (session === null) {
    return <PublicLanding
      catalog={publicCatalog}
      onStartOrder={() => void startOwnerSession()}
      onQuoteStartOrder={() => void startOwnerSession()}
      bookingPending={ownerPending}
      footerContent={<div className="public-staff-entry">
        <button type="button" className="access-text-button" onClick={() => { setAccessMode('STAFF'); setAccessError(''); }}>员工登录</button>
        {accessMode === 'STAFF' && <StaffLoginPanel api={api} onAuthenticated={loadSession}/>}
      </div>}
      {...(catalogFailed ? { onReloadCatalog: () => void loadCatalog() } : {})}
      quoteSelection={quoteSelection}
      onQuoteChange={setQuoteSelection}
    >
      <section id="pilot-access" className="public-access-zone" aria-label="订单与员工入口">
        <div><p className="access-kicker">已有订单</p><h2>恢复订单访问</h2><p>在新设备上，可粘贴已保存的恢复凭据。</p>
          <button type="button" className="access-text-button" onClick={() => { setAccessMode('RECOVERY'); setAccessError(''); }}>恢复订单</button>
        </div>
        {accessMode === 'RECOVERY' && <RecoverySessionPanel error={accessError} onRecover={recover}/>}
        {accessError && accessMode === 'NONE' && <p className="pilot-error" role="alert">{accessError}</p>}
      </section>
    </PublicLanding>;
  }

  if (session.mustChangePassword) return <StaffPasswordPanel api={api} onChanged={loadSession} onLogout={logout}/>;

  if (firstOrderRecoveryDelivery) return <FirstOrderRecoveryDelivery
    api={api}
    onDelivered={(credential) => {
      deliverRecoveryIfCurrent(
        firstOrderRecoveryDelivery,
        sessionUserId.current,
        credential,
        setRecoveryCredential,
      );
      setFirstOrderRecoveryDelivery(null);
    }}
  />;

  if (recoveryCredential) return <main className="pilot-state-page"><RecoveryCredentialCard
    credential={recoveryCredential} onClose={closeRecoveryCredential}
  /></main>;

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
        <span>南京 · 上门宠物照护</span>
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
        startBooking={startBooking} onStartBookingConsumed={() => setStartBooking(false)}
        onRecovery={() => void issueReplacementRecovery()} recoveryPending={recoveryRotating}
        onFirstOrderCreated={() => setFirstOrderRecoveryDelivery(session.userId)}
      />}
      {session.role === 'PROVIDER' && <ProviderPilotWorkspace
        key={session.userId} api={api} displayName={session.displayName} onError={handleProtectedError}
      />}
    </main>
  </div>;
}

type FirstOrderRecoveryDeliveryProps = {
  api: Pick<PilotApi, 'issueRecoveryCredential' | 'rotateRecoveryCredential'>;
  onDelivered(credential: OwnerRecoveryCredential): void;
};

export function deliverRecoveryIfCurrent(
  expectedUserId: string,
  currentUserId: string | null,
  credential: OwnerRecoveryCredential,
  deliver: (credential: OwnerRecoveryCredential) => void,
): void {
  if (expectedUserId === currentUserId) deliver(credential);
}

export function FirstOrderRecoveryDelivery({ api, onDelivered }: FirstOrderRecoveryDeliveryProps) {
  const [stage, setStage] = useState<'ISSUING' | 'RETRY_ISSUE' | 'ROTATE_REQUIRED'>('ISSUING');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const initialRequest = useRef(false);

  const issue = useCallback(async () => {
    setPending(true);
    setError('');
    try {
      onDelivered(await api.issueRecoveryCredential());
    } catch (caught) {
      if (caught instanceof PilotApiError && caught.code === 'RECOVERY_ALREADY_ISSUED') {
        setStage('ROTATE_REQUIRED');
      } else {
        setStage('RETRY_ISSUE');
        setError('未能确认恢复凭据是否已经签发，请重试确认。');
      }
    } finally {
      setPending(false);
    }
  }, [api, onDelivered]);

  useEffect(() => {
    if (initialRequest.current) return;
    initialRequest.current = true;
    void issue();
  }, [issue]);

  const rotate = async () => {
    setPending(true);
    setError('');
    try {
      onDelivered(await api.rotateRecoveryCredential());
    } catch {
      setError('安全轮换暂时失败。订单仍然有效，请保持本页面打开并重试。');
    } finally {
      setPending(false);
    }
  };

  if (stage === 'ISSUING') return <main className="pilot-state-page" aria-live="polite">
    <section className="pilot-state-card" role="status"><h1>订单已提交</h1><p>正在生成只显示一次的恢复凭据…</p></section>
  </main>;

  if (stage === 'ROTATE_REQUIRED') return <main className="pilot-state-page">
    <section className="pilot-state-card" role="dialog" aria-modal="true" aria-labelledby="recovery-rotation-title">
      <h1 id="recovery-rotation-title">需要安全轮换恢复凭据</h1>
      <p>订单已经提交成功。原凭据可能已经签发，但浏览器没有收到原文；安全轮换会立即停用该凭据并显示一份新的凭据。</p>
      {error && <p className="pilot-error" role="alert">{error}</p>}
      <button type="button" disabled={pending} onClick={() => void rotate()}>{pending ? '正在安全轮换…' : '安全轮换并显示新凭据'}</button>
    </section>
  </main>;

  return <main className="pilot-state-page">
    <section className="pilot-state-card" role="dialog" aria-modal="true" aria-labelledby="recovery-retry-title">
      <h1 id="recovery-retry-title">恢复凭据尚未交付</h1>
      <p>订单已经提交成功，但恢复凭据的交付状态暂时无法确认。请保持本页面打开。</p>
      {error && <p className="pilot-error" role="alert">{error}</p>}
      <button type="button" disabled={pending} onClick={() => void issue()}>{pending ? '正在重试…' : '重试获取恢复凭据'}</button>
    </section>
  </main>;
}

function RecoverySessionPanel({ error, onRecover }: { error: string; onRecover(token: string): Promise<void> }) {
  const [token, setToken] = useState('');
  const [pending, setPending] = useState(false);
  return <section className="access-card recovery-login" aria-labelledby="recovery-login-title">
    <h2 id="recovery-login-title">恢复订单</h2><p>粘贴你保存的恢复链接或恢复凭据。</p>
    <form onSubmit={(event) => {
      event.preventDefault(); setPending(true);
      const fromLink = /#\/orders\/access\/([A-Za-z0-9_-]{43})$/.exec(token.trim());
      void onRecover(fromLink?.[1] ?? token.trim()).finally(() => setPending(false));
    }}>
      <label>恢复凭据<input autoComplete="off" value={token} required onChange={(event) => setToken(event.target.value)}/></label>
      {error && <p className="pilot-error" role="alert">{error}</p>}
      <button className="access-primary" type="submit" disabled={pending}>{pending ? '正在恢复…' : '恢复我的订单'}</button>
    </form>
  </section>;
}
