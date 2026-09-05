import { useRef, useState } from 'react';
import { type PilotApi, pilotErrorMessage } from './api.js';

type StaffLoginPanelProps = { api: PilotApi; onAuthenticated(): Promise<void> };

export function StaffLoginPanel({ api, onAuthenticated }: StaffLoginPanelProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true; setPending(true); setError('');
    try {
      await api.createStaffSession(username.trim(), password);
      setPassword('');
      await onAuthenticated();
    } catch (caught) {
      setError(pilotErrorMessage(caught));
    } finally { lock.current = false; setPending(false); }
  };
  return <section className="access-card staff-login" aria-labelledby="staff-login-title">
    <p className="access-kicker">仅限已创建账户</p><h2 id="staff-login-title">员工登录</h2>
    <form onSubmit={(event) => void submit(event)}>
      <label>用户名<input value={username} autoComplete="username" required onChange={(event) => setUsername(event.target.value)}/></label>
      <label>密码<input type="password" value={password} autoComplete="current-password" required onChange={(event) => setPassword(event.target.value)}/></label>
      {error && <p className="pilot-error" role="alert">{error}</p>}
      <button className="access-primary" type="submit" disabled={pending}>{pending ? '正在登录…' : '登录'}</button>
    </form>
  </section>;
}
