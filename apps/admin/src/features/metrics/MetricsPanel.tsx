import { definePilotMetrics } from './metrics.js';
export function MetricsPanel() {
  const metrics = definePilotMetrics({ from: '2026-08-01', to: '2026-08-31', timezone: 'Asia/Shanghai' });
  return <section><h2>试点指标</h2>{metrics.map((metric) => <div className="card" key={metric.key}><strong>{metric.key}</strong>
    <p>分子：{metric.numerator}</p><p>分母：{metric.denominator}</p><small>{metric.timezone} · {metric.window}</small></div>)}</section>;
}
