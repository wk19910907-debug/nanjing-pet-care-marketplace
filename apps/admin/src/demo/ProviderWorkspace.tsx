import { useState } from 'react';
import { ProviderApplicationPanel } from './ProviderApplicationPanel.js';
import type { DemoState, ProviderApplicationDraft, ServiceReport } from './workflow.js';
import { OrderCard } from './OwnerWorkspace.js';

const emptyReport: ServiceReport = { fedAndWatered: false, areaCleaned: false, notes: '' };
export function ProviderWorkspace(props: { state: DemoState; providerId?: string; selectProvider(providerId: string): void; submitApplication(draft: ProviderApplicationDraft): boolean; start(orderId: string, providerId: string): void; report(orderId: string, providerId: string, report: ServiceReport): void }) {
  const [reports, setReports] = useState<Record<string, ServiceReport>>({});
  const update = (orderId: string, patch: Partial<ServiceReport>) => setReports((items) => ({ ...items, [orderId]: { ...(items[orderId] ?? emptyReport), ...patch } }));
  const provider = props.state.providers.find((item) => item.id === props.providerId && item.verified);
  const tasks = provider ? props.state.orders.filter((item) => item.providerId === provider.id) : [];
  return <section className="workspace"><ProviderApplicationPanel applications={props.state.providerApplications} submit={props.submitApplication} /><div className="section-title"><div><span className="eyebrow">PROVIDER</span><h2>今日服务任务</h2></div><div className="provider-identity-summary"><label className="provider-identity-control">体验服务人员身份<select value={provider?.id ?? ''} disabled={props.state.providers.length === 0} onChange={(event) => props.selectProvider(event.target.value)}>{!provider && <option value="">暂无可用的已认证体验身份</option>}{props.state.providers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.district} · 已认证</option>)}</select></label>{provider && <p>当前身份：{provider.name} · {provider.district} · 已认证<br/><span>可提供服务：{provider.services.map((service) => service === 'CAT_FEEDING' ? '上门喂猫' : '上门遛狗').join('、')}</span></p>}</div></div>
    {!provider ? <div className="empty">暂无可用的已认证体验身份。</div> : <div className="orders">{tasks.length === 0 ? <div className="empty">暂无已匹配任务。</div> : [...tasks].reverse().map((order) => { const report = reports[order.id] ?? emptyReport; return <div key={order.id}><OrderCard order={order}/>
      {order.status === 'WAITING_SERVICE' && <button onClick={() => props.start(order.id, provider.id)}>开始服务</button>}
      {order.status === 'IN_SERVICE' && <div className="service-panel"><h4>履约清单</h4><label className="check"><input type="checkbox" checked={report.fedAndWatered} onChange={(event) => update(order.id, { fedAndWatered: event.target.checked })}/>已完成喂食换水</label><label className="check"><input type="checkbox" checked={report.areaCleaned} onChange={(event) => update(order.id, { areaCleaned: event.target.checked })}/>已清理宠物区域</label><label>服务记录<textarea value={report.notes} onChange={(event) => update(order.id, { notes: event.target.value })} placeholder="记录宠物状态和完成事项"/></label><button onClick={() => props.report(order.id, provider.id, report)}>提交服务报告</button></div>}
    </div>; })}</div>}
  </section>;
}
