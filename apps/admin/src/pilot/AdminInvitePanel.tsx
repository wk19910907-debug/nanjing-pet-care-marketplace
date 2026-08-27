import { type FormEvent, useCallback, useEffect, useState } from 'react';
import type { PilotApi } from './api.js';
import type { PilotInvite, PilotInviteCreated, PilotInviteRole } from './models.js';

const ROLE_LABELS = { OWNER: '宠主', PROVIDER: '服务人员', ADMIN: '管理员' } as const;

const formatDate = (value: string) => new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium', timeStyle: 'short', hour12: false,
}).format(new Date(value));

type AdminInvitePanelProps = {
  api: PilotApi;
  onError: (error: unknown) => string | null;
};

export function AdminInvitePanel({ api, onError }: AdminInvitePanelProps) {
  const [role, setRole] = useState<PilotInviteRole>('OWNER');
  const [invites, setInvites] = useState<PilotInvite[]>([]);
  const [created, setCreated] = useState<PilotInviteCreated | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setCreated(null);
    setLoading(true);
    setError('');
    try {
      setInvites(await api.listInvites());
    } catch (caught) {
      const message = onError(caught);
      if (message) setError(message);
    } finally {
      setLoading(false);
    }
  }, [api, onError]);

  useEffect(() => { void refresh(); }, [refresh]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setCreated(null);
    setError('');
    try {
      setCreated(await api.createInvite(role));
    } catch (caught) {
      const message = onError(caught);
      if (message) setError(message);
    } finally {
      setPending(false);
    }
  };

  return <section className="pilot-panel" aria-labelledby="pilot-invites-title">
    <div className="pilot-panel-heading">
      <div>
        <p className="pilot-kicker">平台工作区</p>
        <h2 id="pilot-invites-title">邀请码管理</h2>
      </div>
      <button className="pilot-secondary" type="button" onClick={() => void refresh()} disabled={loading}>
        {loading ? '正在刷新…' : '刷新邀请记录'}
      </button>
    </div>
    <form className="pilot-invite-form" onSubmit={submit}>
      <label htmlFor="pilot-invite-role">邀请角色</label>
      <select
        id="pilot-invite-role"
        value={role}
        onChange={(event) => setRole(event.target.value as PilotInviteRole)}
      >
        <option value="OWNER">宠主</option>
        <option value="PROVIDER">服务人员</option>
      </select>
      <button type="submit" disabled={pending}>{pending ? '正在创建…' : '创建一次性邀请码'}</button>
    </form>
    {error && <p className="pilot-error" role="alert">{error}</p>}
    {created && <div className="pilot-one-time-code" role="status">
      <strong>{ROLE_LABELS[created.role]}邀请码</strong>
      <code>{created.code}</code>
      <span>有效期至 {formatDate(created.expiresAt)}</span>
      <p>邀请码仅显示一次，请通过受控线下渠道交付。</p>
    </div>}
    <div className="pilot-invite-list" aria-busy={loading}>
      <h3>最近邀请记录</h3>
      {!loading && invites.length === 0 && <p className="pilot-empty">尚无邀请记录。</p>}
      {invites.map((invite) => <article key={invite.id} className="pilot-invite-item">
        <strong>{ROLE_LABELS[invite.role]} · {invite.consumedAt ? '已使用' : '未使用'}</strong>
        <span>创建于 {formatDate(invite.createdAt)}</span>
        <span>有效期至 {formatDate(invite.expiresAt)}</span>
      </article>)}
    </div>
  </section>;
}
