import { useRef, useState } from 'react';
import { type PilotApi, pilotErrorMessage } from './api.js';
import type { LocalPilotRole } from './models.js';

type LoginPanelProps = {
  api: PilotApi;
  onAuthenticated: () => Promise<void>;
};

const ENTRY_OPTIONS = [
  { role: 'OWNER', label: '以宠主身份进入', pendingLabel: '正在以宠主身份进入…' },
  { role: 'PROVIDER', label: '以服务人员身份进入', pendingLabel: '正在以服务人员身份进入…' },
  { role: 'ADMIN', label: '以平台管理员身份进入', pendingLabel: '正在以平台管理员身份进入…' },
] as const satisfies ReadonlyArray<{
  role: LocalPilotRole;
  label: string;
  pendingLabel: string;
}>;

export function LoginPanel({ api, onAuthenticated }: LoginPanelProps) {
  const [pendingRole, setPendingRole] = useState<LocalPilotRole | null>(null);
  const [error, setError] = useState('');
  const requestInFlight = useRef(false);

  const enter = async (role: LocalPilotRole) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setPendingRole(role);
    setError('');
    try {
      await api.createLocalSession(role);
      await onAuthenticated();
    } catch (caught) {
      setError(pilotErrorMessage(caught));
    } finally {
      requestInFlight.current = false;
      setPendingRole(null);
    }
  };

  return <main className="pilot-auth-page">
    <section className="pilot-auth-card" aria-labelledby="pilot-login-title">
      <p className="pilot-kicker">南京安心宠 · 本地试运营</p>
      <h1 id="pilot-login-title">选择进入身份</h1>
      <p className="pilot-lead">请选择体验身份进入南京本地试运营。</p>
      <div className="pilot-form" aria-label="试运营身份入口">
        {ENTRY_OPTIONS.map(({ role, label, pendingLabel }) => <button
          key={role}
          type="button"
          disabled={pendingRole !== null}
          onClick={() => void enter(role)}
        >
          {pendingRole === role ? pendingLabel : label}
        </button>)}
      </div>
      {error && <p className="pilot-error" role="alert">{error}</p>}
      <div className="pilot-boundary">
        <strong>隐私与试运营边界</strong>
        <p>此页面不要求联系方式或真实姓名。</p>
        <p>进入后可设置展示昵称。</p>
      </div>
    </section>
  </main>;
}
