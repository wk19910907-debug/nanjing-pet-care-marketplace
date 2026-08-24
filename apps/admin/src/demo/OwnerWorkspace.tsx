import { useState, type FormEvent } from 'react';
import type { DemoOrder, DemoState, OrderDraft } from './workflow.js';

const statusText = {
  WAITING_MATCH: '待平台匹配', WAITING_SERVICE: '已匹配，等待服务', IN_SERVICE: '服务进行中',
  WAITING_CONFIRMATION: '等待宠主确认', COMPLETED: '服务已完成',
} as const;

export function OrderCard(props: { order: DemoOrder; providerName?: string | undefined; confirm?(): void }) {
  const { order } = props;
  return <article className="order-card"><div className="order-head"><strong>{order.petName} · {order.serviceType === 'CAT_FEEDING' ? '上门喂猫' : '遛狗'}</strong>
    <span className={`status status-${order.status.toLowerCase()}`}>{statusText[order.status]}</span></div>
    <p>{order.district} · {order.address}</p><p>{order.scheduledAt.replace('T', ' ')} · ¥{(order.priceFen / 100).toFixed(2)}</p>
    {props.providerName && <p>服务人员：{props.providerName}</p>}
    {order.report && <div className="report"><strong>服务报告</strong><p>{order.report.notes}</p></div>}
    {order.status === 'WAITING_CONFIRMATION' && props.confirm && <button onClick={props.confirm}>确认完成</button>}
  </article>;
}

export function OwnerWorkspace(props: { state: DemoState; create(draft: OrderDraft): void; confirm(orderId: string): void }) {
  const [draft, setDraft] = useState<OrderDraft>({ serviceType: 'CAT_FEEDING', petName: '', district: '建邺区', address: '', scheduledAt: '2026-08-24T19:00', notes: '' });
  const change = <K extends keyof OrderDraft>(key: K, value: OrderDraft[K]) => setDraft((item) => ({ ...item, [key]: value }));
  const submit = (event: FormEvent) => { event.preventDefault(); props.create(draft); };
  return <section className="workspace"><div className="section-title"><div><span className="eyebrow">OWNER</span><h2>预约上门服务</h2></div><p>提交需求后，由平台匹配已认证服务人员。</p></div>
    <form className="order-form" onSubmit={submit}>
      <label>服务类型<select value={draft.serviceType} onChange={(event) => change('serviceType', event.target.value as OrderDraft['serviceType'])}><option value="CAT_FEEDING">上门喂猫 · ¥32</option><option value="DOG_WALKING">上门遛狗 · ¥37</option></select></label>
      <label>宠物昵称<input value={draft.petName} onChange={(event) => change('petName', event.target.value)} placeholder="例如：团子"/></label>
      <label>服务区域<select value={draft.district} onChange={(event) => change('district', event.target.value)}><option>建邺区</option><option>鼓楼区</option><option>玄武区</option><option>秦淮区</option></select></label>
      <label>详细地址<input value={draft.address} onChange={(event) => change('address', event.target.value)} placeholder="仅填写体验地址，请勿输入门锁密码"/></label>
      <label>上门时间<input type="datetime-local" value={draft.scheduledAt} onChange={(event) => change('scheduledAt', event.target.value)}/></label>
      <label className="wide">服务备注<textarea value={draft.notes} onChange={(event) => change('notes', event.target.value)} placeholder="宠物习惯、用品位置等（请勿填写敏感信息）"/></label>
      <button className="primary wide" type="submit">提交订单</button>
    </form><h3>我的订单</h3><div className="orders">{props.state.orders.length === 0 ? <div className="empty">还没有订单，请先提交一次服务需求。</div> : [...props.state.orders].reverse().map((order) => <OrderCard key={order.id} order={order} providerName={props.state.providers.find((item) => item.id === order.providerId)?.name} confirm={() => props.confirm(order.id)}/>)}</div>
  </section>;
}
