import type { OrderStatus, OwnerOrder, PublicOperationsCatalog, ServiceType } from '../models.js';

type OwnerHomeProps = {
  displayName: string;
  orders: OwnerOrder[];
  loading: boolean;
  catalog: PublicOperationsCatalog;
  onBook(serviceType: ServiceType): void;
  onRefresh(): void;
};

const SERVICES = [
  {
    type: 'CAT_FEEDING' as const,
    title: '上门喂猫',
    mark: '猫',
    copy: '喂食换水、清洁宠物区域、提交服务记录',
  },
  {
    type: 'DOG_WALKING' as const,
    title: '上门遛狗',
    mark: '犬',
    copy: '牵引散步、饮水照看、提交服务记录',
  },
] as const;

const TRUST = [
  ['身份审核', '审核通过后才进入匹配范围'],
  ['平台匹配', '按区域与服务能力安排人员'],
  ['服务留痕', '服务照片与标准报告可查看'],
] as const;

const STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: '等待平台核对费用',
  PENDING_DISPATCH: '等待平台匹配服务人员',
  PENDING_SERVICE: '已匹配，等待上门服务',
  IN_SERVICE: '服务进行中',
  PENDING_CONFIRMATION: '服务报告待确认',
  COMPLETED: '服务已完成',
  CANCELLED: '订单已取消',
  REFUND_PENDING: '退款处理中',
  REFUNDED: '已退款',
  DISPUTED: '争议处理中',
  DISPATCH_FAILED: '匹配未成功',
  EXPIRED: '订单已过期',
};

const TERMINAL_STATUSES = new Set<OrderStatus>(['COMPLETED', 'CANCELLED', 'REFUNDED', 'EXPIRED']);

function fen(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency', currency: 'CNY', minimumFractionDigits: 2,
  }).format(value / 100);
}

function localDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

function startingPrice(value: number): string {
  return `¥${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value / 100)} 起`;
}

export function OwnerHome({ catalog, displayName, orders, loading, onBook, onRefresh }: OwnerHomeProps) {
  const activeOrder = orders.find((order) => !TERMINAL_STATUSES.has(order.status));
  const services = SERVICES.filter((service) => catalog.services[service.type].enabled);
  return <section id="owner-home" className="owner-home">
    <header className="owner-hero">
      <div className="owner-hero-copy">
        <p className="owner-location">南京 · {services.length > 0 ? '今日可预约' : '暂未开放预约'}</p>
        <h1>今天需要照顾谁？</h1>
        <p>提交需求，平台为你匹配合适的服务人员。</p>
      </div>
      <div className="owner-hero-mark" aria-hidden="true"><span>安心</span><strong>宠</strong></div>
    </header>

    {catalog.announcement && <p className="owner-announcement" role="status">{catalog.announcement}</p>}

    <section className="owner-section" aria-labelledby="owner-services-title">
      <div className="owner-section-heading"><div><p>南京本地服务</p><h2 id="owner-services-title">选择需要的照护</h2></div></div>
      <div className="owner-services">
        {services.map((service) => <article key={service.type} className="owner-service-card">
          <div className="owner-service-top"><span aria-hidden="true">{service.mark}</span><b>{startingPrice(catalog.services[service.type].basePriceFen)}</b></div>
          <h3>{service.title}</h3>
          <p>{service.copy}</p>
          <button type="button" onClick={() => onBook(service.type)}>预约{service.title}</button>
        </article>)}
        {services.length === 0 && <p className="pilot-empty">当前服务暂未开放，请稍后再来。</p>}
      </div>
    </section>

    <section className="owner-current-order" aria-labelledby="owner-current-title">
      <div className="owner-section-heading">
        <div><p>服务进度</p><h2 id="owner-current-title">当前订单</h2></div>
        <button type="button" className="owner-text-button" disabled={loading} onClick={onRefresh}>
          {loading ? '正在刷新…' : '刷新'}
        </button>
      </div>
      {activeOrder ? <article className="owner-active-order">
        <div><span className="pilot-status">{STATUS_LABELS[activeOrder.status]}</span>
          <h3>{activeOrder.petNames?.join('、') ?? '宠物'} · {activeOrder.serviceType === 'CAT_FEEDING' ? '上门喂猫' : '上门遛狗'}</h3>
          <p>{localDateTime(activeOrder.startsAt)} · {activeOrder.district}</p>
        </div>
        <strong>{fen(activeOrder.totalFen)}</strong>
        <a href="#owner-orders">查看订单进度</a>
      </article> : <div className="owner-order-empty">
        <div><strong>还没有进行中的服务</strong><p>选择喂猫或遛狗，几步即可提交需求。</p></div>
        {services[0] && <button type="button" onClick={() => onBook(services[0]!.type)}>立即预约</button>}
      </div>}
    </section>

    <section className="owner-section owner-trust" aria-labelledby="owner-trust-title">
      <div className="owner-section-heading"><div><p>平台保障</p><h2 id="owner-trust-title">每次上门都有交代</h2></div></div>
      <div className="owner-trust-grid">{TRUST.map(([title, copy], index) => <article key={title}>
        <span aria-hidden="true">0{index + 1}</span><strong>{title}</strong><p>{copy}</p>
      </article>)}</div>
    </section>

    <section id="owner-account" className="owner-account" aria-labelledby="owner-account-title">
      <div><p>我的</p><h2 id="owner-account-title">{displayName}</h2></div>
      <span>宠主账户 · 南京上门宠物照护</span>
    </section>
  </section>;
}
