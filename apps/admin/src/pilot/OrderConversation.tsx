import { useCallback, useEffect, useRef, useState } from 'react';
import type { PilotApi } from './api.js';
import type { OrderMessage, PilotRole } from './models.js';

type Props = { api: PilotApi; orderId: string; role: Extract<PilotRole, 'OWNER' | 'ADMIN'>; onError(caught: unknown): string | null };
const AUTHOR: Record<OrderMessage['authorRole'], string> = { OWNER: '宠主', ADMIN: '平台运营' };

function unique(items: OrderMessage[]): OrderMessage[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.id) && (seen.add(item.id), true));
}

export function OrderConversation({ api, orderId, role, onError }: Props) {
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const request = useRef(0);
  const sendLock = useRef(false);
  const olderLock = useRef(false);

  const current = (value: number) => mounted.current && epoch.current === value;
  const load = useCallback(async (older = false, knownCursor?: string, expectedEpoch = epoch.current) => {
    if (older && olderLock.current) return;
    const version = ++request.current;
    if (older) { olderLock.current = true; setLoadingOlder(true); } else setLoading(true);
    setError('');
    try {
      const page = await api.listOrderMessages(orderId, older ? knownCursor : undefined);
      if (!current(expectedEpoch) || request.current !== version) return;
      setMessages((existing) => unique(older ? [...page.items, ...existing] : page.items));
      setCursor(page.nextCursor);
    } catch (caught) {
      if (current(expectedEpoch) && request.current === version) setError(onError(caught) ?? '沟通记录暂时无法读取');
    } finally {
      if (current(expectedEpoch) && request.current === version) {
        if (older) { olderLock.current = false; setLoadingOlder(false); } else setLoading(false);
      }
    }
  }, [api, onError, orderId]);

  useEffect(() => {
    mounted.current = true;
    const expectedEpoch = ++epoch.current;
    request.current += 1;
    sendLock.current = false; olderLock.current = false;
    setMessages([]); setCursor(undefined); setDraft(''); setError(''); setSending(false); setLoadingOlder(false);
    void load(false, undefined, expectedEpoch);
    return () => { request.current += 1; };
  }, [load, orderId]);
  useEffect(() => () => { mounted.current = false; epoch.current += 1; request.current += 1; }, []);

  const send = async () => {
    const body = draft.trim();
    if (!body || Array.from(body).length > 500 || sendLock.current) return;
    const expectedEpoch = epoch.current;
    sendLock.current = true; setSending(true); setError('');
    try {
      const sent = await api.sendOrderMessage(orderId, body);
      if (!current(expectedEpoch)) return;
      setMessages((existing) => unique([...existing, sent]));
      setDraft('');
    } catch (caught) {
      if (current(expectedEpoch)) setError(onError(caught) ?? '消息发送失败，请重试');
    } finally {
      if (current(expectedEpoch)) { sendLock.current = false; setSending(false); }
    }
  };

  return <section className="pilot-order-conversation" aria-label={`订单 ${orderId} 沟通`}>
    <div className="pilot-conversation-heading"><h4>订单沟通</h4><button type="button" className="pilot-secondary" disabled={loading || sending} onClick={() => void load()}>{loading ? '正在刷新…' : '刷新沟通记录'}</button></div>
    <p className="pilot-hint">仅宠主与平台运营可见；服务人员不参与订单沟通。</p>
    {error && <p className="pilot-error" role="alert">{error}</p>}
    <div className="pilot-message-list" aria-live="polite">
      {cursor && <button type="button" className="pilot-secondary" disabled={loading || loadingOlder || sending} onClick={() => void load(true, cursor)}>加载更早消息</button>}
      {loading && messages.length === 0 ? <p>正在读取沟通记录…</p> : messages.length === 0 ? <p className="pilot-empty">暂时没有沟通记录。</p> : messages.map((message) => <article key={message.id} className={`pilot-message pilot-message-${message.authorRole.toLowerCase()}`}><strong>{AUTHOR[message.authorRole]} · {message.body}</strong><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString('zh-CN')}</time></article>)}
    </div>
    <label className="pilot-message-compose">订单沟通内容<textarea aria-label="订单沟通内容" value={draft} maxLength={1000} onChange={(event) => setDraft(Array.from(event.target.value).slice(0, 500).join(''))} disabled={sending}/><small>{Array.from(draft).length}/500</small></label>
    <button type="button" disabled={sending || !draft.trim()} onClick={() => void send()}>{sending ? '正在发送…' : '发送消息'}</button>
  </section>;
}
