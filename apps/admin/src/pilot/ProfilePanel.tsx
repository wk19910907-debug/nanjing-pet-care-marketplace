import { type FormEvent, useState } from 'react';
import type { PilotApi } from './api.js';

type ProfilePanelProps = {
  api: PilotApi;
  onSaved: () => Promise<void>;
  onLogout: () => Promise<void>;
  onError: (error: unknown) => string | null;
};

export function ProfilePanel({ api, onSaved, onLogout, onError }: ProfilePanelProps) {
  const [displayName, setDisplayName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!displayName.trim() || pending) return;
    setPending(true);
    setError('');
    try {
      await api.updateProfile(displayName.trim());
      await onSaved();
    } catch (caught) {
      const message = onError(caught);
      if (message) setError(message);
    } finally {
      setPending(false);
    }
  };

  return <main className="pilot-auth-page">
    <section className="pilot-auth-card" aria-labelledby="pilot-profile-title">
      <p className="pilot-kicker">首次使用</p>
      <h1 id="pilot-profile-title">设置展示昵称</h1>
      <p className="pilot-lead">昵称不是实名，也不用于登录或线下身份核验。</p>
      <form onSubmit={submit} className="pilot-form">
        <label htmlFor="pilot-display-name">展示昵称</label>
        <input
          id="pilot-display-name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          minLength={1}
          maxLength={30}
          autoComplete="off"
          required
        />
        <p className="pilot-hint">1–30 个字符，请勿填写联系方式或连续 6 位以上数字。</p>
        {error && <p className="pilot-error" role="alert">{error}</p>}
        <button type="submit" disabled={pending || !displayName.trim()}>
          {pending ? '正在保存…' : '保存昵称'}
        </button>
      </form>
      <button className="pilot-secondary" type="button" onClick={() => void onLogout()}>
        退出登录
      </button>
    </section>
  </main>;
}
