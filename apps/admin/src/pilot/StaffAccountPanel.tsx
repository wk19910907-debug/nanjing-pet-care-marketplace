import { useCallback, useEffect, useRef, useState } from 'react';
import type { PilotApi } from './api.js';
import type { StaffAccount } from './models.js';

type Props = { api: PilotApi; onError(caught: unknown): string | null };
type Confirmation = { kind: 'disable' | 'enable' | 'reset'; account: StaffAccount };

function temporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const values = new Uint32Array(16);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join('');
}

export function StaffAccountPanel({ api, onError }: Props) {
  const [accounts, setAccounts] = useState<StaffAccount[]>([]);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [oneTimePassword, setOneTimePassword] = useState('');
  const lifecycle = useRef({ mounted: false, load: 0 });
  const locks = useRef(new Set<string>());

  const load = useCallback(async () => {
    const request = ++lifecycle.current.load;
    setLoading(true);
    try {
      const next = await api.listStaffAccounts();
      if (lifecycle.current.mounted && request === lifecycle.current.load) setAccounts(next);
    } catch (caught) {
      if (lifecycle.current.mounted && request === lifecycle.current.load) setError(onError(caught) ?? '员工账号暂时无法读取');
    } finally {
      if (lifecycle.current.mounted && request === lifecycle.current.load) setLoading(false);
    }
  }, [api, onError]);

  useEffect(() => {
    lifecycle.current.mounted = true;
    void load();
    return () => { lifecycle.current.mounted = false; lifecycle.current.load += 1; };
  }, [load]);

  const run = async (key: string, operation: () => Promise<void>, onSuccess?: () => void) => {
    if (locks.current.has(key) || !lifecycle.current.mounted) return;
    locks.current.add(key); setPending(key); setError('');
    try {
      await operation();
      if (!lifecycle.current.mounted) return;
      onSuccess?.();
      setConfirmation(null);
      await load();
    } catch (caught) {
      if (lifecycle.current.mounted) setError(onError(caught) ?? '操作失败，请稍后重试');
    } finally {
      if (lifecycle.current.mounted) { locks.current.delete(key); setPending(''); }
    }
  };

  const create = (event: React.FormEvent) => {
    event.preventDefault();
    const key = 'create';
    const password = temporaryPassword();
    void run(key, () => api.createStaffAccount({ username: username.trim(), displayName: displayName.trim(), temporaryPassword: password }).then(() => undefined), () => {
      setUsername(''); setDisplayName(''); setOneTimePassword(password);
    });
  };

  const confirm = () => {
    if (!confirmation) return;
    const { account, kind } = confirmation;
    if (kind === 'reset') {
      const password = temporaryPassword();
      void run(`reset:${account.userId}`, () => api.resetStaffPassword(account.userId, password), () => setOneTimePassword(password));
      return;
    }
    void run(`account:${account.userId}`, () => api.updateStaffAccount(account.userId, { disabled: kind === 'disable' }).then(() => undefined));
  };

  return <section className="pilot-staff-panel" aria-labelledby="staff-accounts-title">
    <div className="pilot-panel-heading"><div><p className="pilot-kicker">员工权限</p><h2 id="staff-accounts-title">服务人员账号</h2></div>
      <button type="button" className="pilot-secondary" onClick={() => void load()} disabled={loading || Boolean(pending)}>{loading ? '正在刷新…' : '刷新员工列表'}</button></div>
    <p className="pilot-hint">这里只能创建服务人员账号。临时密码只在当前页面显示一次，请通过安全渠道交付。</p>
    {error && <p className="pilot-error" role="alert">{error}</p>}
    {oneTimePassword && <p className="pilot-one-time-secret" role="status"><strong>临时密码（仅显示一次）</strong><code>{oneTimePassword}</code><button type="button" className="pilot-secondary" onClick={() => setOneTimePassword('')}>我已安全记录，关闭</button></p>}
    <form className="pilot-staff-create" onSubmit={create}>
      <label>员工用户名<input aria-label="员工用户名" value={username} autoComplete="off" required onChange={(event) => setUsername(event.target.value)}/></label>
      <label>员工展示名称<input aria-label="员工展示名称" value={displayName} autoComplete="off" required onChange={(event) => setDisplayName(event.target.value)}/></label>
      <button type="submit" disabled={pending === 'create'}>{pending === 'create' ? '正在创建…' : '创建服务人员账号'}</button>
    </form>
    {loading ? <p aria-live="polite">正在读取员工账号…</p> : <div className="pilot-staff-list">
      {accounts.length === 0 ? <p className="pilot-empty">目前没有服务人员账号。</p> : accounts.map((account) => <article className="pilot-staff-row" key={account.userId}>
        <div><strong>{account.displayName}</strong><span>{account.username} · 服务人员</span><small>{account.disabledAt ? '已停用' : account.mustChangePassword ? '首次登录需修改临时密码' : '可正常登录'}</small></div>
        <div className="pilot-staff-actions">
          {account.disabledAt ? <button type="button" onClick={() => setConfirmation({ kind: 'enable', account })}>启用 {account.username}</button> : <>
            <button type="button" onClick={() => setConfirmation({ kind: 'reset', account })}>重置 {account.username} 临时密码</button>
            <button type="button" className="pilot-secondary" onClick={() => setConfirmation({ kind: 'disable', account })}>停用 {account.username}</button>
          </>}
        </div>
        {confirmation?.account.userId === account.userId && <div className="pilot-inline-confirm" role="group" aria-label={`确认${confirmation.kind === 'reset' ? '重置' : confirmation.kind === 'disable' ? '停用' : '启用'} ${account.username}${confirmation.kind === 'reset' ? ' 临时密码' : ''}`}>
          <strong>{confirmation.kind === 'reset' ? '确认重置后，旧密码立即失效。' : `确认${confirmation.kind === 'disable' ? '停用' : '启用'}该服务人员账号。`}</strong>
          <div><button type="button" disabled={Boolean(pending)} onClick={confirm}>{pending ? '正在处理…' : confirmation.kind === 'reset' ? '确认重置临时密码' : `确认${confirmation.kind === 'disable' ? '停用' : '启用'}`}</button><button type="button" className="pilot-secondary" disabled={Boolean(pending)} onClick={() => setConfirmation(null)}>取消</button></div>
        </div>}
      </article>)}
    </div>}
  </section>;
}
