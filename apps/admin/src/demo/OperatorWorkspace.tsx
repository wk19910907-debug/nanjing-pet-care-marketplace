import { useState } from 'react';
import type { DemoState } from './workflow.js';
import { OrderCard } from './OwnerWorkspace.js';

export function OperatorWorkspace(props: { state: DemoState; assign(orderId: string, providerId: string): void }) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  return <section className="workspace"><div className="section-title"><div><span className="eyebrow">PLATFORM</span><h2>平台匹配中心</h2></div><p>只匹配已认证、支持相应服务的人员。</p></div>
    <div className="summary-grid"><div><strong>{props.state.orders.filter((item) => item.status === 'WAITING_MATCH').length}</strong><span>待匹配</span></div><div><strong>{props.state.providers.length}</strong><span>已认证人员</span></div><div><strong>{props.state.audit.length}</strong><span>操作记录</span></div></div>
    <div className="orders">{props.state.orders.length === 0 ? <div className="empty">暂无订单，先切换到宠主提交订单。</div> : [...props.state.orders].reverse().map((order) => <div key={order.id}><OrderCard order={order} providerName={props.state.providers.find((item) => item.id === order.providerId)?.name}/>
      {order.status === 'WAITING_MATCH' && <div className="match-panel"><label>匹配服务人员<select value={choices[order.id] ?? props.state.providers[0]!.id} onChange={(event) => setChoices((items) => ({ ...items, [order.id]: event.target.value }))}>{props.state.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.district} · 已认证</option>)}</select></label><button onClick={() => props.assign(order.id, choices[order.id] ?? props.state.providers[0]!.id)}>确认匹配</button></div>}
    </div>)}</div>
  </section>;
}
