import { useState } from 'react';
import type { DemoState, ServiceReport } from './workflow.js';
import { OrderCard } from './OwnerWorkspace.js';

const emptyReport: ServiceReport = { fedAndWatered: false, areaCleaned: false, notes: '' };
export function ProviderWorkspace(props: { state: DemoState; providerId: string; start(orderId: string): void; report(orderId: string, report: ServiceReport): void }) {
  const [reports, setReports] = useState<Record<string, ServiceReport>>({});
  const update = (orderId: string, patch: Partial<ServiceReport>) => setReports((items) => ({ ...items, [orderId]: { ...(items[orderId] ?? emptyReport), ...patch } }));
  const tasks = props.state.orders.filter((item) => item.providerId === props.providerId);
  return <section className="workspace"><div className="section-title"><div><span className="eyebrow">PROVIDER</span><h2>今日服务任务</h2></div><p>当前身份：王小宁 · 已认证</p></div>
    <div className="orders">{tasks.length === 0 ? <div className="empty">暂无已匹配任务。</div> : [...tasks].reverse().map((order) => { const report = reports[order.id] ?? emptyReport; return <div key={order.id}><OrderCard order={order}/>
      {order.status === 'WAITING_SERVICE' && <button onClick={() => props.start(order.id)}>开始服务</button>}
      {order.status === 'IN_SERVICE' && <div className="service-panel"><h4>履约清单</h4><label className="check"><input type="checkbox" checked={report.fedAndWatered} onChange={(event) => update(order.id, { fedAndWatered: event.target.checked })}/>已完成喂食换水</label><label className="check"><input type="checkbox" checked={report.areaCleaned} onChange={(event) => update(order.id, { areaCleaned: event.target.checked })}/>已清理宠物区域</label><label>服务记录<textarea value={report.notes} onChange={(event) => update(order.id, { notes: event.target.value })} placeholder="记录宠物状态和完成事项"/></label><button onClick={() => props.report(order.id, report)}>提交服务报告</button></div>}
    </div>; })}</div>
  </section>;
}
