import { useRef, useState } from 'react';
import { DEFAULT_OPERATIONS_CATALOG } from '@pet/contracts';
import { OperatorWorkspace } from './OperatorWorkspace.js';
import { OwnerWorkspace } from './OwnerWorkspace.js';
import { ProviderWorkspace } from './ProviderWorkspace.js';
import { PublicLanding } from './PublicLanding.js';
import type { PublicQuoteSelection } from './publicQuote.js';
import { approveProviderApplication, assignOrder, confirmOrder, createInitialState, createOrder, loadDemoState, preferredProviderId, saveDemoState, startService, submitProviderApplication, submitReport, type DemoState, type OrderDraft, type ProviderApplicationDraft, type ServiceReport } from './workflow.js';

type Role = 'OWNER' | 'OPERATOR' | 'PROVIDER';
export type OrderPrefill = PublicQuoteSelection & { requestKey: number };
export function DemoApp() {
  const fixture = new URLSearchParams(window.location.search).get('fixture');
  const [state, setState] = useState<DemoState>(() => fixture === 'service-loop' || fixture === 'provider-onboarding' ? createInitialState() : loadDemoState(window.localStorage));
  const [role, setRole] = useState<Role>('OWNER');
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>(() => preferredProviderId(state));
  const [notice, setNotice] = useState('可以从宠主下单开始体验完整流程。');
  const [quoteSelection, setQuoteSelection] = useState<PublicQuoteSelection>({ serviceType: 'CAT_FEEDING', district: '建邺区' });
  const [orderPrefill, setOrderPrefill] = useState<OrderPrefill>();
  const [ownerResetKey, setOwnerResetKey] = useState(0);
  const orderPrefillRequestKey = useRef(0);
  const apply = (operation: (current: DemoState) => DemoState, message: string): boolean => { try { const next = operation(state); setState(next); saveDemoState(window.localStorage, next); setNotice(message); return true; } catch (error) { setNotice(error instanceof Error ? error.message : '操作失败，请重试'); return false; } };
  const reset = () => { const next = createInitialState(); setState(next); setSelectedProviderId(preferredProviderId(next)); saveDemoState(window.localStorage, next); setOrderPrefill(undefined); setOwnerResetKey((key) => key + 1); setRole('OWNER'); setNotice('演示数据已清空。'); };
  const startOrderExperience = () => {
    setRole('OWNER');
    window.requestAnimationFrame(() => {
      document.getElementById('order-experience')?.scrollIntoView({ behavior: 'instant', block: 'start' });
    });
  };
  const startQuoteOrderExperience = (selection = quoteSelection) => {
    setOrderPrefill({ ...selection, requestKey: ++orderPrefillRequestKey.current });
    startOrderExperience();
  };
  const viewOrders = () => {
    setRole('OWNER');
    window.requestAnimationFrame(() => document.getElementById('demo-owner-orders')?.scrollIntoView({ behavior: 'instant', block: 'start' }));
  };
  const showProvider = () => {
    setSelectedProviderId(preferredProviderId(state, selectedProviderId));
    setRole('PROVIDER');
  };
  return <div className="demo-shell"><PublicLanding catalog={DEFAULT_OPERATIONS_CATALOG} onStartOrder={startOrderExperience} onViewOrders={viewOrders} onQuoteStartOrder={startQuoteOrderExperience} quoteSelection={quoteSelection} onQuoteChange={setQuoteSelection}>
    <section id="order-experience" className="demo-intro" aria-labelledby="demo-intro-title"><span className="eyebrow">PRODUCT DEMO</span><h2 id="demo-intro-title">平台功能演示</h2><p>演示数据仅保存在当前浏览器，不会形成真实订单。</p></section>
    <nav className="role-tabs" aria-label="功能演示角色"><button className={role === 'OWNER' ? 'active' : ''} onClick={() => setRole('OWNER')}>宠主</button><button className={role === 'OPERATOR' ? 'active' : ''} onClick={() => setRole('OPERATOR')}>平台运营</button><button className={role === 'PROVIDER' ? 'active' : ''} onClick={showProvider}>服务人员</button><button className="reset" onClick={reset}>清空演示数据</button></nav>
    <div className="notice" role="status">{notice}</div><div className="demo-main">
      {role === 'OWNER' && (
        <OwnerWorkspace key={ownerResetKey} state={state} prefill={orderPrefill} consumePrefill={() => setOrderPrefill(undefined)} create={(draft: OrderDraft) => apply((current) => createOrder(current, draft), '订单已提交，等待平台匹配。')} confirm={(id) => apply((current) => confirmOrder(current, id), '订单已确认完成。')} />
      )}
      {role === 'OPERATOR' && <OperatorWorkspace state={state} approve={(id) => { apply((current) => approveProviderApplication(current, id), '审核通过，申请人已进入匹配池。'); }} assign={(id, providerId) => { if (apply((current) => assignOrder(current, id, providerId), '已完成匹配并通知服务人员。')) setSelectedProviderId(providerId); }}/>}
      {role === 'PROVIDER' && <ProviderWorkspace state={state} {...(selectedProviderId ? { providerId: selectedProviderId } : {})} selectProvider={setSelectedProviderId} submitApplication={(draft: ProviderApplicationDraft) => apply((current) => submitProviderApplication(current, draft), '申请已提交，等待平台审核。')} start={(id, providerId) => apply((current) => startService(current, id, providerId), '服务已开始，请完成清单。')} report={(id, providerId, report: ServiceReport) => apply((current) => submitReport(current, id, providerId, report), '报告已提交，等待宠主确认。')}/>}
    </div>
    </PublicLanding></div>;
}
