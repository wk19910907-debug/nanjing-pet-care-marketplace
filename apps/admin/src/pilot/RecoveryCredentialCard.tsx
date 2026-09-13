import { useEffect, useRef, useState } from 'react';
import type { OwnerRecoveryCredential } from './models.js';

type RecoveryCredentialCardProps = {
  credential: OwnerRecoveryCredential;
  onClose(): void;
};

function recoveryUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}

export function RecoveryCredentialCard({ credential, onClose }: RecoveryCredentialCardProps) {
  const [error, setError] = useState('');
  const [copying, setCopying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const copyButton = useRef<HTMLButtonElement>(null);
  const masked = `${credential.token.slice(0, 5)}••••••••••••••••${credential.token.slice(-4)}`;

  useEffect(() => { copyButton.current?.focus(); }, []);

  const copy = async () => {
    setCopying(true); setError('');
    try {
      await navigator.clipboard.writeText(recoveryUrl(credential.recoveryPath));
    } catch {
      setError('复制失败。恢复凭据仍保留在本页面，请重试或下载保存。');
    } finally { setCopying(false); }
  };

  const download = () => {
    setDownloading(true); setError('');
    let objectUrl = '';
    try {
      const contents = [
        '安心宠 — 账户恢复凭据',
        '',
        `站点：${window.location.origin}`,
        `恢复链接：${recoveryUrl(credential.recoveryPath)}`,
        '',
        '请妥善保存此链接。任何获得它的人都可以恢复并查看你的订单。不要转发给他人。',
      ].join('\n');
      objectUrl = URL.createObjectURL(new Blob([contents], { type: 'text/plain;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = '安心宠-恢复凭据.txt';
      anchor.click();
    } catch {
      setError('下载失败。恢复凭据仍保留在本页面，请重试或复制保存。');
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setDownloading(false);
    }
  };

  return <section className="access-card recovery-credential" role="dialog" aria-modal="true" aria-labelledby="recovery-credential-title">
    <p className="access-kicker">首次预约 · 必须保存</p>
    <h1 id="recovery-credential-title">保存你的恢复凭据</h1>
    <p>它只在此刻展示一次。更换设备或清除浏览器数据后，可用它找回订单。</p>
    <output aria-label="恢复凭据（已隐藏）" className="recovery-masked">{masked}</output>
    <p className="access-warning">任何得到恢复链接的人都可进入你的订单。请勿转发、截图上传或存入公共设备。</p>
    <div className="access-actions">
      <button ref={copyButton} type="button" className="access-primary" disabled={copying || downloading} onClick={() => void copy()}>{copying ? '正在复制…' : '复制恢复链接'}</button>
      <button type="button" disabled={copying || downloading} onClick={download}>{downloading ? '正在下载…' : '下载文本文件'}</button>
    </div>
    {error && <p role="alert" className="pilot-error">{error}</p>}
    <button type="button" className="access-confirm" onClick={onClose}>我已保存</button>
  </section>;
}
