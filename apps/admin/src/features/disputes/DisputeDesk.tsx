import { useState } from 'react';
export function DisputeDesk(props: { resolved: boolean; resolve(amountFen: number): void }) {
  const [amount, setAmount] = useState('1000');
  return <section><h2>投诉退款</h2><div className="card"><strong>NJ-20260823-002 · {props.resolved ? '已解决 · 退款 ¥10.00' : '待处理投诉'}</strong>
    <p>宠主反馈照片与服务内容不符；结算已冻结。</p>{!props.resolved && <><label>退款金额（分）<input value={amount} onChange={(event) => setAmount(event.target.value)}/></label>
      <button onClick={() => props.resolve(Number(amount))}>解决投诉</button></>}</div></section>;
}
