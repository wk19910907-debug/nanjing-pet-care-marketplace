import { useCallback, useEffect, useRef, useState } from 'react';
import { createIdempotencyKey, type PilotApi } from './api.js';
import type { AdminOrder, OrderStatus, ProviderReviewQueueItem, ReviewStatus, ServiceType } from './models.js';

type Props = { api: PilotApi; onError(caught: unknown): string | null };
type Confirmation =
  | { kind: 'review'; id: string; label: string }
  | { kind: 'fee'; id: string; key: string }
  | { kind: 'dispatch'; id: string };

const SERVICE_LABELS: Record<ServiceType, string> = {
  CAT_FEEDING: '上门喂猫', DOG_WALKING: '上门遛狗',
};
const REVIEW_LABELS: Record<Exclude<ReviewStatus, 'PENDING'>, string> = {
  APPROVED: '批准', REJECTED: '拒绝', SUSPENDED: '暂停',
};
const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  PENDING: '待审核', APPROVED: '已批准', REJECTED: '已拒绝', SUSPENDED: '已暂停',
};
const TIMELINE = ['费用核对', '平台派单', '等待服务', '服务中', '报告确认', '已完成'] as const;

function stage(order: AdminOrder): number {
  const stages: Readonly<Partial<Record<OrderStatus, number>>> = {
    PENDING_PAYMENT: 0, PENDING_DISPATCH: 1, PENDING_SERVICE: 2, IN_SERVICE: 3,
    PENDING_CONFIRMATION: 4, COMPLETED: 5,
  };
  return stages[order.status] ?? -1;
}

function OrderCard({ order, action }: {
  order: AdminOrder;
  action?: React.ReactNode;
}) {
  const current = stage(order);
  return <article className="pilot-ops-card">
    <div className="pilot-ops-card-head">
      <div><span className="pilot-status">{order.status}</span><h3>{SERVICE_LABELS[order.serviceType]}</h3></div>
      <strong>¥{(order.totalFen / 100).toFixed(2)}</strong>
    </div>
    <p className="pilot-order-id">订单 {order.id}</p>
    <dl className="pilot-order-facts">
      <div><dt>宠主昵称</dt><dd>{order.ownerDisplayName ?? '未设置昵称'}</dd></div>
      <div><dt>服务时间</dt><dd>{new Date(order.startsAt).toLocaleString('zh-CN')} · {order.durationMinutes} 分钟</dd></div>
      <div><dt>安全区域</dt><dd>{order.city} · {order.district} · {order.serviceZone}服务圈</dd></div>
    </dl>
    {current >= 0
      ? <ol className="pilot-compact-timeline" aria-label={`订单 ${order.id} 进度`}>
          {TIMELINE.map((label, index) => <li key={label} className={index < current ? 'is-done' : index === current ? 'is-current' : ''}>{label}</li>)}
        </ol>
      : <p className="pilot-order-exception">当前状态：{order.status}。系统已停止自动推进，请人工检查审计记录。</p>}
    {action}
  </article>;
}

function Empty({ children }: { children: string }) {
  return <p className="pilot-empty">{children}</p>;
}

export function AdminPilotWorkspace({ api, onError }: Props) {
  const [reviews, setReviews] = useState<ProviderReviewQueueItem[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [pending, setPending] = useState('');
  const lifecycle = useRef({ mounted: false, generation: 0, load: 0 });
  const locks = useRef(new Set<string>());

  const reportError = useCallback((caught: unknown, generation: number) => {
    if (!lifecycle.current.mounted || lifecycle.current.generation !== generation) return;
    const message = onError(caught);
    if (message !== null) setError(message);
  }, [onError]);

  const load = useCallback(async (showLoading = true, generation = lifecycle.current.generation) => {
    if (!lifecycle.current.mounted || lifecycle.current.generation !== generation) return;
    const version = ++lifecycle.current.load;
    if (showLoading) setLoading(true);
    setError('');
    try {
      const [nextReviews, nextOrders] = await Promise.all([
        api.listProviderReviewQueue(), api.listAdminOrders(),
      ]);
      if (!lifecycle.current.mounted || lifecycle.current.generation !== generation || lifecycle.current.load !== version) return;
      setReviews(nextReviews);
      setOrders(nextOrders);
    } catch (caught) {
      if (lifecycle.current.load === version) reportError(caught, generation);
    } finally {
      if (lifecycle.current.mounted && lifecycle.current.generation === generation && lifecycle.current.load === version) setLoading(false);
    }
  }, [api, reportError]);

  useEffect(() => {
    lifecycle.current.mounted = true;
    const generation = ++lifecycle.current.generation;
    void load(true, generation);
    return () => {
      lifecycle.current.mounted = false;
      lifecycle.current.generation += 1;
      lifecycle.current.load += 1;
    };
  }, [load]);

  const mutate = async (lockKey: string, operation: () => Promise<void>) => {
    if (locks.current.has(lockKey)) return;
    const generation = lifecycle.current.generation;
    if (!lifecycle.current.mounted) return;
    locks.current.add(lockKey);
    setPending(lockKey);
    setError('');
    try {
      await operation();
      if (!lifecycle.current.mounted || lifecycle.current.generation !== generation) return;
      setConfirmation(null);
      await load(false, generation);
    } catch (caught) {
      reportError(caught, generation);
    } finally {
      if (lifecycle.current.mounted && lifecycle.current.generation === generation) {
        locks.current.delete(lockKey);
        setPending('');
      }
    }
  };

  const review = (status: Exclude<ReviewStatus, 'PENDING'>) => {
    if (confirmation?.kind !== 'review') return;
    const { id } = confirmation;
    void mutate(`review:${id}`, () => api.reviewProvider(id, status));
  };
  const confirmFee = () => {
    if (confirmation?.kind !== 'fee') return;
    const { id, key } = confirmation;
    void mutate(`fee:${id}`, () => api.confirmManualFee(id, key));
  };
  const dispatch = () => {
    if (confirmation?.kind !== 'dispatch') return;
    const { id } = confirmation;
    void mutate(`dispatch:${id}`, () => api.startDispatch(id));
  };

  const fees = orders.filter((order) => order.status === 'PENDING_PAYMENT');
  const dispatches = orders.filter((order) => order.status === 'PENDING_DISPATCH');
  const failures = orders.filter((order) => order.status === 'DISPATCH_FAILED');

  return <section className="pilot-admin-workspace">
    <div className="pilot-workspace-heading">
      <div><p className="pilot-kicker">平台运营</p><h1>平台工作区</h1></div>
      <button type="button" className="pilot-secondary" disabled={loading} onClick={() => void load()}>{loading ? '正在刷新…' : '刷新运营数据'}</button>
    </div>
    <p className="pilot-owner-intro">逐人审核、逐单核对与派单；所有列表仅显示运营所需的脱敏字段。</p>
    <p className="pilot-offline-fee">本系统未处理在线支付</p>
    {error && <p className="pilot-error" role="alert">{error}</p>}
    {loading ? <div className="pilot-owner-loading" aria-live="polite">正在读取运营数据…</div> : <div className="pilot-ops-grid">
      <section className="pilot-ops-section" aria-labelledby="admin-review-title">
        <h2 id="admin-review-title">服务人员审核</h2>
        {reviews.length === 0 ? <Empty>当前没有待审核申请。</Empty> : reviews.map((item) => <article className="pilot-ops-card" key={item.id}>
          <div className="pilot-ops-card-head"><div><span className="pilot-status">{REVIEW_STATUS_LABELS[item.reviewStatus]}</span><h3>{item.displayName}</h3></div></div>
          <p>{item.serviceZone} · {item.radiusKm} 公里 · {item.serviceTypes.map((type) => SERVICE_LABELS[type]).join('、')}</p>
          <p>喂猫经验 {item.catExperienceMonths} 月 · 遛狗经验 {item.dogExperienceMonths} 月</p>
          {item.reviewStatus === 'PENDING' && <button type="button" onClick={() => setConfirmation({ kind: 'review', id: item.id, label: item.displayName })}>审核{item.displayName}</button>}
          {item.reviewStatus === 'APPROVED' && <button type="button" onClick={() => setConfirmation({ kind: 'review', id: item.id, label: item.displayName })}>暂停{item.displayName}</button>}
          {confirmation?.kind === 'review' && confirmation.id === item.id && <div className="pilot-inline-confirm" role="group" aria-label={`确认审核${item.displayName}`}>
            <strong>本次只审核：{item.displayName}</strong>
            <p>线下核验材料不会在本系统展示。</p>
            <div>{(item.reviewStatus === 'APPROVED'
              ? ['SUSPENDED'] as const
              : ['APPROVED', 'REJECTED'] as const).map((status) => <button
              key={status} type="button" disabled={pending === `review:${item.id}`} onClick={() => review(status)}
            >确认{REVIEW_LABELS[status]}{item.reviewStatus === 'APPROVED' ? item.displayName : ''}</button>)}</div>
            <button type="button" className="pilot-secondary" disabled={Boolean(pending)} onClick={() => setConfirmation(null)}>取消</button>
          </div>}
        </article>)}
      </section>

      <section className="pilot-ops-section" aria-labelledby="admin-fee-title">
        <h2 id="admin-fee-title">待核对费用</h2>
        {fees.length === 0 ? <Empty>当前没有待核对费用的订单。</Empty> : fees.map((order) => <OrderCard key={order.id} order={order} action={<>
          <button type="button" onClick={() => setConfirmation({ kind: 'fee', id: order.id, key: createIdempotencyKey() })}>核对订单 {order.id} 费用</button>
          {confirmation?.kind === 'fee' && confirmation.id === order.id && <div className="pilot-inline-confirm" role="group" aria-label={`确认订单 ${order.id} 费用`}>
            <strong>订单 {order.id}</strong><p>只记录平台已在线下核对费用，不代表系统收款。</p>
            <button type="button" disabled={pending === `fee:${order.id}`} onClick={confirmFee}>{pending === `fee:${order.id}` ? '正在记录…' : '确认记录费用已线下核对'}</button>
            <button type="button" className="pilot-secondary" disabled={Boolean(pending)} onClick={() => setConfirmation(null)}>取消</button>
          </div>}
        </>}/>)}
      </section>

      <section className="pilot-ops-section" aria-labelledby="admin-dispatch-title">
        <h2 id="admin-dispatch-title">待派单</h2>
        {dispatches.length === 0 ? <Empty>当前没有待派单订单。</Empty> : dispatches.map((order) => <OrderCard key={order.id} order={order} action={<>
          <button type="button" onClick={() => setConfirmation({ kind: 'dispatch', id: order.id })}>派单订单 {order.id}</button>
          {confirmation?.kind === 'dispatch' && confirmation.id === order.id && <div className="pilot-inline-confirm" role="group" aria-label={`确认派单订单 ${order.id}`}>
            <strong>订单 {order.id}</strong><p>服务器只会邀请符合服务、区域、可用时间与并发上限的已审核人员。</p>
            <button type="button" disabled={pending === `dispatch:${order.id}`} onClick={dispatch}>{pending === `dispatch:${order.id}` ? '正在启动…' : '确认启动派单'}</button>
            <button type="button" className="pilot-secondary" disabled={Boolean(pending)} onClick={() => setConfirmation(null)}>取消</button>
          </div>}
        </>}/>)}
      </section>

      <section className="pilot-ops-section" aria-labelledby="admin-failure-title">
        <h2 id="admin-failure-title">派单异常</h2>
        {failures.length === 0 ? <Empty>当前没有派单异常。</Empty> : failures.map((order) => <OrderCard key={order.id} order={order}/>)}
      </section>
      <section className="pilot-ops-section pilot-all-orders" aria-labelledby="admin-all-orders-title">
        <h2 id="admin-all-orders-title">全部订单进度</h2>
        <p className="pilot-hint">只读时间线用于核对单笔订单状态；精确位置始终不在管理员列表中返回。</p>
        {orders.length === 0 ? <Empty>当前没有订单。</Empty> : orders.map((order) => <OrderCard key={order.id} order={order}/>)}
      </section>
    </div>}
  </section>;
}
