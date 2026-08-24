import { maskOperationalOrder } from '../access.js';
export function DispatchBoard(props: { assigned: boolean; assign(): void }) {
  const order = maskOperationalOrder({ id: 'NJ-20260823-001', district: '建邺区', serviceZone: '奥体东',
    addressDetail: '江东中路2栋301', accessInstructions: '门锁1234', ownerPhone: '13800000000' });
  return <section><h2>订单调度</h2><div className="card"><strong>{order.id} · 派单失败</strong><p>{order.addressDetail}</p>
    <p>上门喂猫 · 30 分钟 · 已付款</p>{props.assigned ? <b>已指派 王小宁</b> : <button onClick={props.assign}>人工指派</button>}</div></section>;
}
