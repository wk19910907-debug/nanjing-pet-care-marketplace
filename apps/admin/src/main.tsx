import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { navigationForRole, type OperatorRole } from './features/access.js';
import { OperatorView } from './routes.js';
import { DemoApp } from './demo/DemoApp.js';
import { PilotApp } from './pilot/PilotApp.js';
import './styles.css';
import './demo/customer-web.css';

function Console() {
  const [role, setRole] = useState<OperatorRole>('REVIEWER');
  const [path, setPath] = useState('/providers');
  const [approved, setApproved] = useState(false);
  const [assigned, setAssigned] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [audit, setAudit] = useState<string[]>([]);
  const record = (message: string) => setAudit((items) => [...items, message]);
  return <div className="shell"><aside><h1>安心宠</h1><p>平台运营台</p><label>当前角色<select value={role} onChange={(event) => {
    const next = event.target.value as OperatorRole; setRole(next); setPath(navigationForRole(next)[0]!.path);
  }}><option value="REVIEWER">审核员</option><option value="DISPATCHER">调度员</option><option value="SUPPORT">客服</option><option value="ADMIN">管理员</option></select></label>
    <nav>{navigationForRole(role).map((item) => <button key={item.path} onClick={() => setPath(item.path)}>{item.label}</button>)}</nav></aside>
    <main><OperatorView path={path} approved={approved} assigned={assigned} resolved={resolved} audit={audit}
      approve={() => { setApproved(true); record('批准服务者'); }} assign={() => { setAssigned(true); record('人工指派订单'); }}
      resolve={() => { setResolved(true); record('部分退款解决投诉'); }}/></main></div>;
}

const operatorFixture = new URLSearchParams(window.location.search).get('fixture') === 'operator-flow';
const pilotMode = import.meta.env.MODE === 'pilot';
createRoot(document.getElementById('root')!).render(
  <StrictMode>{pilotMode ? <PilotApp/> : operatorFixture ? <Console/> : <DemoApp/>}</StrictMode>,
);
