import { useRef, useState } from 'react';
import { OperatorWorkspace } from './OperatorWorkspace.js';
import { OwnerWorkspace } from './OwnerWorkspace.js';
import { ProviderWorkspace } from './ProviderWorkspace.js';
import { PublicLanding } from './PublicLanding.js';
import type { PublicQuoteSelection } from './publicQuote.js';
import { approveProviderApplication, assignOrder, confirmOrder, createInitialState, createOrder, loadDemoState, saveDemoState, startService, submitProviderApplication, submitReport, type DemoState, type OrderDraft, type ProviderApplicationDraft, type ServiceReport } from './workflow.js';

type Role = 'OWNER' | 'OPERATOR' | 'PROVIDER';
export type OrderPrefill = PublicQuoteSelection & { requestKey: number };
export function DemoApp() {
  const fixture = new URLSearchParams(window.location.search).get('fixture');
  const [state, setState] = useState<DemoState>(() => fixture === 'service-loop' || fixture === 'provider-onboarding' ? createInitialState() : loadDemoState(window.localStorage));
  const [role, setRole] = useState<Role>('OWNER');
  const [notice, setNotice] = useState('可以从宠主下单开始体验完整流程。');
  const [quoteSelection, setQuoteSelection] = useState<PublicQuoteSelection>({ serviceType: 'CAT_FEEDING', district: '建邺区' });
  const [orderPrefill, setOrderPrefill] = useState<OrderPrefill>();
  const orderPrefillRequestKey = useRef(0);
  const apply = (operation: (current: DemoState) => DemoState, message: string): boolean => { try { const next = operation(state); setState(next); saveDemoState(window.localStorage, next); setNotice(message); return true; } catch (error) { setNotice(error instanceof Error ? error.message : '操作失败，请重试'); return false; } };
  const reset = () => { const next = createInitialState(); setState(next); saveDemoState(window.localStorage, next); setOrderPrefill(undefined); setRole('OWNER'); setNotice('体验数据已恢复。'); };
  const startOrderExperience = () => {
    setRole('OWNER');
    window.requestAnimationFrame(() => {
      document.getElementById('order-experience')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
  const startQuoteOrderExperience = () => {
    setOrderPrefill({ ...quoteSelection, requestKey: ++orderPrefillRequestKey.current });
    startOrderExperience();
  };
  return <div className="demo-shell"><header className="topbar"><div className="brand"><span className="brand-mark">宠</span><div><strong>南京安心宠</strong><small>上门喂猫 · 遛狗</small></div></div><div className="demo-badge">安全体验版</div></header>
    <PublicLanding onStartOrder={startOrderExperience} onQuoteStartOrder={startQuoteOrderExperience} quoteSelection={quoteSelection} onQuoteChange={setQuoteSelection}>
    <nav id="order-experience" className="role-tabs" aria-label="体验身份"><button className={role === 'OWNER' ? 'active' : ''} onClick={() => setRole('OWNER')}>宠主</button><button className={role === 'OPERATOR' ? 'active' : ''} onClick={() => setRole('OPERATOR')}>平台运营</button><button className={role === 'PROVIDER' ? 'active' : ''} onClick={() => setRole('PROVIDER')}>服务人员</button><button className="reset" onClick={reset}>恢复体验数据</button></nav>
    <div className="notice" role="status">{notice}</div><main className="demo-main">
      {role === 'OWNER' && (
        <OwnerWorkspace state={state} prefill={orderPrefill} consumePrefill={() => setOrderPrefill(undefined)} create={(draft: OrderDraft) => apply((current) => createOrder(current, draft), '订单已提交，等待平台匹配。')} confirm={(id) => apply((current) => confirmOrder(current, id), '订单已确认完成。')} />
      )}
      {role === 'OPERATOR' && <OperatorWorkspace state={state} approve={(id) => { apply((current) => approveProviderApplication(current, id), '审核通过，申请人已进入匹配池。'); }} assign={(id, providerId) => apply((current) => assignOrder(current, id, providerId), '已完成匹配并通知服务人员。')}/>}
      {role === 'PROVIDER' && <ProviderWorkspace state={state} providerId="provider-wang" submitApplication={(draft: ProviderApplicationDraft) => apply((current) => submitProviderApplication(current, draft), '申请已提交，等待平台审核。')} start={(id) => apply((current) => startService(current, id), '服务已开始，请完成清单。')} report={(id, report: ServiceReport) => apply((current) => submitReport(current, id, report), '报告已提交，等待宠主确认。')}/>}
    </main>
    </PublicLanding><footer>体验数据只保存在当前浏览器 · 当前不承接真实订单 · 请勿填写真实门锁密码或敏感信息</footer></div>;
}
