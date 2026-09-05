import { useRef, useState } from 'react';
import { type PilotApi, pilotErrorMessage } from './api.js';

type StaffPasswordPanelProps = { api: PilotApi; onChanged(): Promise<void>; onLogout(): Promise<void> };

export function StaffPasswordPanel({ api, onChanged, onLogout }: StaffPasswordPanelProps) {
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false); const [error, setError] = useState('');
  const lock = useRef(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    if (password !== confirm) { setError('两次输入的密码不一致。'); return; }
    lock.current = true; setPending(true); setError('');
    try { await api.changeStaffPassword(password); setPassword(''); setConfirm(''); await onChanged(); }
    catch (caught) { setError(pilotErrorMessage(caught)); }
    finally { lock.current = false; setPending(false); }
  };
  return <main className="pilot-state-page"><section className="access-card staff-password" aria-labelledby="staff-password-title">
    <p className="access-kicker">为保护工作账户</p><h1 id="staff-password-title">请先修改临时密码</h1>
    <p>修改完成前，无法进入任何工作页面。</p>
    <form onSubmit={(event) => void submit(event)}>
      <label>新密码<input type="password" value={password} autoComplete="new-password" minLength={12} required onChange={(event) => setPassword(event.target.value)}/></label>
      <label>确认新密码<input type="password" value={confirm} autoComplete="new-password" minLength={12} required onChange={(event) => setConfirm(event.target.value)}/></label>
      {error && <p className="pilot-error" role="alert">{error}</p>}
      <button className="access-primary" type="submit" disabled={pending}>{pending ? '正在保存…' : '保存新密码'}</button>
    </form>
    <button className="access-text-button" type="button" disabled={pending} onClick={() => void onLogout()}>退出登录</button>
  </section></main>;
}
