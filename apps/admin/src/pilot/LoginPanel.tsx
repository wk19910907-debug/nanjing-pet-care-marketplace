import { type FormEvent, useState } from 'react';
import { type PilotApi, pilotErrorMessage } from './api.js';

type LoginPanelProps = {
  api: PilotApi;
  onAuthenticated: () => Promise<void>;
};

export function LoginPanel({ api, onAuthenticated }: LoginPanelProps) {
  const [inviteCode, setInviteCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!inviteCode.trim() || pending) return;
    setPending(true);
    setError('');
    try {
      await api.createSession(inviteCode.trim());
      setInviteCode('');
      await onAuthenticated();
    } catch (caught) {
      setError(pilotErrorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  return <main className="pilot-auth-page">
    <section className="pilot-auth-card" aria-labelledby="pilot-login-title">
      <p className="pilot-kicker">南京安心宠 · 受控试运营</p>
      <h1 id="pilot-login-title">邀请码登录</h1>
      <p className="pilot-lead">仅限平台线下邀请的南京试点用户使用。</p>
      <form onSubmit={submit} className="pilot-form">
        <label htmlFor="pilot-invite-code">邀请码</label>
        <input
          id="pilot-invite-code"
          value={inviteCode}
          onChange={(event) => setInviteCode(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          required
        />
        {error && <p className="pilot-error" role="alert">{error}</p>}
        <button type="submit" disabled={pending || !inviteCode.trim()}>
          {pending ? '正在验证…' : '进入试运营'}
        </button>
      </form>
      <div className="pilot-boundary">
        <strong>隐私与试运营边界</strong>
        <p>邀请码只用于本次登录。平台不会在此页面要求联系方式或真实姓名。</p>
        <p>本系统仅记录线下费用核对，不处理在线支付。</p>
      </div>
    </section>
  </main>;
}
