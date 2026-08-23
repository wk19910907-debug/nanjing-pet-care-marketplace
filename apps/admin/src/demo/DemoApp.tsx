import { useState } from 'react';
import { OperatorWorkspace } from './OperatorWorkspace.js';
import { OwnerWorkspace } from './OwnerWorkspace.js';
import { ProviderWorkspace } from './ProviderWorkspace.js';
import { assignOrder, confirmOrder, createInitialState, createOrder, loadDemoState, saveDemoState, startService, submitReport, type DemoState, type OrderDraft, type ServiceReport } from './workflow.js';

type Role = 'OWNER' | 'OPERATOR' | 'PROVIDER';
export function DemoApp() {
  const fixture = new URLSearchParams(window.location.search).get('fixture');
  const [state, setState] = useState<DemoState>(() => fixture === 'service-loop' ? createInitialState() : loadDemoState(window.localStorage));
  const [role, setRole] = useState<Role>('OWNER');
  const [notice, setNotice] = useState('可以从宠主下单开始体验完整流程。');
  const apply = (operation: (current: DemoState) => DemoState, message: string) => { try { const next = operation(state); setState(next); saveDemoState(window.localStorage, next); setNotice(message); } catch (error) { setNotice(error instanceof Error ? error.message : '操作失败，请重试'); } };
  const reset = () => { const next = createInitialState(); setState(next); saveDemoState(window.localStorage, next); setRole('OWNER'); setNotice('体验数据已恢复。'); };
  return <div className="demo-shell"><header className="topbar"><div className="brand"><span className="brand-mark">宠</span><div><strong>南京安心宠</strong><small>上门喂猫 · 遛狗</small></div></div><div className="demo-badge">本地体验模式</div></header>
    <div className="hero"><div><span className="eyebrow">MANAGED PET CARE</span><h1>把每一次上门服务<br/>交给平台认真匹配</h1><p>宠主只需提交订单，平台负责匹配认证人员并跟进履约。</p></div><div className="flow-card"><span>服务闭环</span><strong>下单 → 匹配 → 上门 → 报告 → 确认</strong></div></div>
    <nav className="role-tabs" aria-label="体验身份"><button className={role === 'OWNER' ? 'active' : ''} onClick={() => setRole('OWNER')}>宠主</button><button className={role === 'OPERATOR' ? 'active' : ''} onClick={() => setRole('OPERATOR')}>平台运营</button><button className={role === 'PROVIDER' ? 'active' : ''} onClick={() => setRole('PROVIDER')}>服务人员</button><button className="reset" onClick={reset}>恢复体验数据</button></nav>
    <div className="notice" role="status">{notice}</div><main className="demo-main">
      {role === 'OWNER' && <OwnerWorkspace state={state} create={(draft: OrderDraft) => apply((current) => createOrder(current, draft), '订单已提交，等待平台匹配。')} confirm={(id) => apply((current) => confirmOrder(current, id), '订单已确认完成。')}/>} 
      {role === 'OPERATOR' && <OperatorWorkspace state={state} assign={(id, providerId) => apply((current) => assignOrder(current, id, providerId), '已完成匹配并通知服务人员。')}/>} 
      {role === 'PROVIDER' && <ProviderWorkspace state={state} providerId="provider-wang" start={(id) => apply((current) => startService(current, id), '服务已开始，请完成清单。')} report={(id, report: ServiceReport) => apply((current) => submitReport(current, id, report), '报告已提交，等待宠主确认。')}/>} 
    </main><footer>体验数据只保存在当前浏览器 · 请勿填写真实门锁密码或敏感信息</footer></div>;
}
