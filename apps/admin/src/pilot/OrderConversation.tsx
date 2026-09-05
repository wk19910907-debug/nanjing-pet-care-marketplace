import { useCallback, useEffect, useRef, useState } from 'react';
import type { PilotApi } from './api.js';
import type { OrderMessage, PilotRole } from './models.js';

type Props = { api: PilotApi; orderId: string; role: Extract<PilotRole, 'OWNER' | 'ADMIN'>; onError(caught: unknown): string | null };
type LoadMode = 'refresh' | 'later';
const AUTHOR: Record<OrderMessage['authorRole'], string> = { OWNER: '宠主', ADMIN: '平台运营' };

function mergeChronologically(existing: OrderMessage[], incoming: OrderMessage[]): OrderMessage[] {
  const byId = new Map(existing.map((item) => [item.id, item]));
  incoming.forEach((item) => byId.set(item.id, item));
  return [...byId.values()].sort((left, right) => (
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  ));
}

export function OrderConversation({ api, orderId, role, onError }: Props) {
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingLater, setLoadingLater] = useState(false);
  const [sending, setSending] = useState(false);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const refreshRequest = useRef(0);
  const laterRequest = useRef(0);
  const laterLock = useRef(false);
  const sendLock = useRef(false);

  const current = (value: number) => mounted.current && epoch.current === value;
  const load = useCallback(async (mode: LoadMode, afterCursor?: string, expectedEpoch = epoch.current) => {
    if (mode === 'later' && laterLock.current) return;
    const request = mode === 'later' ? ++laterRequest.current : ++refreshRequest.current;
    if (mode === 'later') { laterLock.current = true; setLoadingLater(true); } else setLoading(true);
    setError('');
    try {
      const page = await api.listOrderMessages(orderId, mode === 'later' ? afterCursor : undefined);
      const stillCurrent = current(expectedEpoch) && (mode === 'later' || refreshRequest.current === request);
      if (!stillCurrent) return;
      setMessages((existing) => mergeChronologically(existing, page.items));
      if (mode === 'later') {
        setCursor(page.nextCursor);
      } else {
        setCursor(page.nextCursor);
      }
    } catch (caught) {
      const stillCurrent = current(expectedEpoch) && (mode === 'later' || refreshRequest.current === request);
      if (stillCurrent) setError(onError(caught) ?? '沟通记录暂时无法读取');
    } finally {
      if (!current(expectedEpoch)) return;
      if (mode === 'later' && laterRequest.current === request) { laterLock.current = false; setLoadingLater(false); }
      if (mode === 'refresh' && refreshRequest.current === request) setLoading(false);
    }
  }, [api, onError, orderId]);

  useEffect(() => {
    mounted.current = true;
    const expectedEpoch = ++epoch.current;
    refreshRequest.current += 1; laterRequest.current += 1;
    sendLock.current = false; laterLock.current = false;
    setMessages([]); setCursor(undefined); setDraft(''); setError(''); setSending(false); setLoadingLater(false);
    void load('refresh', undefined, expectedEpoch);
    return () => { refreshRequest.current += 1; laterRequest.current += 1; };
  }, [load, orderId]);
  useEffect(() => () => { mounted.current = false; epoch.current += 1; refreshRequest.current += 1; laterRequest.current += 1; }, []);

  const send = async () => {
    const body = draft.trim();
    if (!body || Array.from(body).length > 500 || sendLock.current) return;
    const expectedEpoch = epoch.current;
    sendLock.current = true; setSending(true); setError('');
    try {
      const sent = await api.sendOrderMessage(orderId, body);
      if (!current(expectedEpoch)) return;
      setMessages((existing) => mergeChronologically(existing, [sent]));
      setDraft('');
    } catch (caught) {
      if (current(expectedEpoch)) setError(onError(caught) ?? '消息发送失败，请重试');
    } finally {
      if (current(expectedEpoch)) { sendLock.current = false; setSending(false); }
    }
  };

  return <section className="pilot-order-conversation" aria-label={`订单 ${orderId} 沟通`}>
    <div className="pilot-conversation-heading"><h4>订单沟通</h4><button type="button" className="pilot-secondary" disabled={loading || loadingLater || sending} onClick={() => void load('refresh')}>{loading ? '正在刷新…' : '刷新沟通记录'}</button></div>
    <p className="pilot-hint">仅宠主与平台运营可见；服务人员不参与订单沟通。</p>
    {error && <p className="pilot-error" role="alert">{error}</p>}
    <div className="pilot-message-list" aria-live="polite">
      {cursor && <button type="button" className="pilot-secondary" disabled={loading || loadingLater || sending} onClick={() => void load('later', cursor)}>加载后续消息</button>}
      {loading && messages.length === 0 ? <p>正在读取沟通记录…</p> : messages.length === 0 ? <p className="pilot-empty">暂时没有沟通记录。</p> : messages.map((message) => <article key={message.id} className={`pilot-message pilot-message-${message.authorRole.toLowerCase()}`}><strong>{AUTHOR[message.authorRole]} · {message.body}</strong><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString('zh-CN')}</time></article>)}
    </div>
    <label className="pilot-message-compose">订单沟通内容<textarea aria-label="订单沟通内容" value={draft} maxLength={1000} onChange={(event) => setDraft(Array.from(event.target.value).slice(0, 500).join(''))} disabled={sending}/><small>{Array.from(draft).length}/500</small></label>
    <button type="button" disabled={sending || !draft.trim()} onClick={() => void send()}>{sending ? '正在发送…' : '发送消息'}</button>
  </section>;
}
