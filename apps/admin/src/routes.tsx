import type { ReactNode } from 'react';
import { DispatchBoard } from './features/dispatch/DispatchBoard.js';
import { DisputeDesk } from './features/disputes/DisputeDesk.js';
import { MetricsPanel } from './features/metrics/MetricsPanel.js';
import { OrderSearch } from './features/orders/OrderSearch.js';
import { ProviderReview } from './features/providers/ProviderReview.js';
import { Settings } from './features/settings/Settings.js';

export function OperatorView(props: {
  path: string; approved: boolean; assigned: boolean; resolved: boolean; audit: string[];
  approve(): void; assign(): void; resolve(amountFen: number): void;
}): ReactNode {
  if (props.path === '/providers') return <ProviderReview approved={props.approved} approve={props.approve}/>;
  if (props.path === '/dispatch') return <DispatchBoard assigned={props.assigned} assign={props.assign}/>;
  if (props.path === '/orders') return <OrderSearch/>;
  if (props.path === '/disputes') return <DisputeDesk resolved={props.resolved} resolve={props.resolve}/>;
  if (props.path === '/metrics') return <MetricsPanel/>;
  if (props.path === '/settings') return <Settings/>;
  if (props.path === '/audit') return <section><h2>审计记录</h2>{props.audit.map((item) => <div className="card" key={item}>{item}</div>)}</section>;
  return <section><h2>试点运营概览</h2><div className="card">仅展示当前角色有权处理的任务。</div></section>;
}
