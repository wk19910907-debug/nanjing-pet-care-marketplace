import { useState } from 'react';
import { eligibleProvidersForOrder, type DemoState } from './workflow.js';
import { OrderCard } from './OwnerWorkspace.js';
import { ProviderReviewQueue } from './ProviderReviewQueue.js';

export function OperatorWorkspace(props: { state: DemoState; approve(applicationId: string): void; assign(orderId: string, providerId: string): void }) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  return <section className="workspace"><div className="section-title"><div><span className="eyebrow">PLATFORM</span><h2>平台匹配中心</h2></div><p>只匹配已认证、支持相应服务的人员。</p></div>
    <div className="summary-grid"><div><strong>{props.state.orders.filter((item) => item.status === 'WAITING_MATCH').length}</strong><span>待匹配</span></div><div><strong>{props.state.providers.length}</strong><span>已认证人员</span></div><div><strong>{props.state.audit.length}</strong><span>操作记录</span></div></div>
    <ProviderReviewQueue applications={props.state.providerApplications} approve={props.approve} />
    <div className="orders">{props.state.orders.length === 0 ? <div className="empty">暂无订单，先切换到宠主提交订单。</div> : [...props.state.orders].reverse().map((order) => {
      const candidates = order.status === 'WAITING_MATCH' ? eligibleProvidersForOrder(props.state, order) : [];
      const savedChoice = choices[order.id];
      const selectedProviderId = candidates.some((provider) => provider.id === savedChoice) ? savedChoice : candidates[0]?.id;
      return <div key={order.id}><OrderCard order={order} providerName={props.state.providers.find((item) => item.id === order.providerId)?.name}/>
        {order.status === 'WAITING_MATCH' && (selectedProviderId ? <div className="match-panel"><label>匹配服务人员<select value={selectedProviderId} onChange={(event) => setChoices((items) => ({ ...items, [order.id]: event.target.value }))}>{candidates.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.district} · 已认证</option>)}</select></label><button onClick={() => props.assign(order.id, selectedProviderId)}>确认匹配</button></div> : <div className="match-panel match-empty">暂无符合区域和服务类型的已认证人员</div>)}
      </div>;
    })}</div>
  </section>;
}
