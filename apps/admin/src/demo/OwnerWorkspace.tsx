import { useEffect, useState, type FormEvent } from 'react';
import type { OrderPrefill } from './DemoApp.js';
import type { DemoOrder, DemoState, OrderDraft } from './workflow.js';

const statusText = {
  WAITING_MATCH: '待平台匹配', WAITING_SERVICE: '已匹配，等待服务', IN_SERVICE: '服务进行中',
  WAITING_CONFIRMATION: '等待宠主确认', COMPLETED: '服务已完成',
} as const;

export function OrderCard(props: { order: DemoOrder; providerName?: string | undefined; confirm?(): void }) {
  const { order } = props;
  return <article className="order-card"><div className="order-head"><strong>{order.petName} · {order.serviceType === 'CAT_FEEDING' ? '上门喂猫' : '遛狗'}</strong>
    <span className={`status status-${order.status.toLowerCase()}`}>{statusText[order.status]}</span></div>
    <p>{order.district} · {order.address}</p><p>{order.scheduledAt.replace('T', ' ')} · ¥{(order.priceFen / 100).toFixed(2)}</p>
    {props.providerName && <p>服务人员：{props.providerName}</p>}
    {order.report && <div className="report"><strong>服务报告</strong><p>{order.report.notes}</p></div>}
    {order.status === 'WAITING_CONFIRMATION' && props.confirm && <button onClick={props.confirm}>确认完成</button>}
  </article>;
}

type BookingStep = 1 | 2 | 3;

const stepLabels: Readonly<Record<BookingStep, string>> = {
  1: '服务与时间', 2: '上门信息', 3: '确认预约',
};

const emptyDraft = (): OrderDraft => ({
  serviceType: 'CAT_FEEDING', petName: '', district: '建邺区', address: '', scheduledAt: '', notes: '',
});

export function OwnerWorkspace(props: { state: DemoState; prefill?: OrderPrefill | undefined; consumePrefill(): void; create(draft: OrderDraft): boolean; confirm(orderId: string): void }) {
  const [draft, setDraft] = useState<OrderDraft>(emptyDraft);
  const [step, setStep] = useState<BookingStep>(1);
  const [showNotes, setShowNotes] = useState(false);
  useEffect(() => {
    if (!props.prefill) return;
    setDraft((item) => ({ ...item, serviceType: props.prefill!.serviceType, district: props.prefill!.district }));
    setStep(1);
    props.consumePrefill();
  }, [props.prefill?.requestKey]);
  const change = <K extends keyof OrderDraft>(key: K, value: OrderDraft[K]) => setDraft((item) => ({ ...item, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!props.create(draft)) return;
    setDraft(emptyDraft());
    setShowNotes(false);
    setStep(1);
  };
  const serviceStepComplete = Boolean(draft.scheduledAt);
  const visitStepComplete = Boolean(draft.petName.trim() && draft.address.trim() && draft.district);
  return <section className="workspace"><div className="section-title"><div><span className="eyebrow">OWNER</span><h2>预约上门服务</h2></div><p>提交需求后，由平台匹配已认证服务人员。</p></div>
    <form className="order-form demo-booking-form" onSubmit={submit}>
      <ol className="owner-booking-progress wide" aria-label="预约进度">
        {([1, 2, 3] as const).map((item) => <li key={item} aria-current={step === item ? 'step' : undefined}>{stepLabels[item]}</li>)}
      </ol>
      <div className="demo-booking-title wide"><span>第 {step} 步，共 3 步</span><h3>{stepLabels[step]}</h3></div>

      {step === 1 && <div className="demo-booking-step wide">
        <label>服务类型<select value={draft.serviceType} onChange={(event) => change('serviceType', event.target.value as OrderDraft['serviceType'])}><option value="CAT_FEEDING">上门喂猫 · ¥32</option><option value="DOG_WALKING">上门遛狗 · ¥37</option></select></label>
        <label>上门时间<input required type="datetime-local" value={draft.scheduledAt} onChange={(event) => change('scheduledAt', event.target.value)}/></label>
        <button className="primary" type="button" disabled={!serviceStepComplete} onClick={() => setStep(2)}>下一步：填写上门信息</button>
      </div>}

      {step === 2 && <div className="demo-booking-step wide">
        <label>宠物昵称<input required value={draft.petName} maxLength={50} onChange={(event) => change('petName', event.target.value)} placeholder="例如：团子"/></label>
        <label>服务区域<select value={draft.district} onChange={(event) => change('district', event.target.value)}><option>建邺区</option><option>鼓楼区</option><option>玄武区</option><option>秦淮区</option></select></label>
        <label>详细地址<input required value={draft.address} maxLength={300} onChange={(event) => change('address', event.target.value)} placeholder="请勿填写门锁密码"/></label>
        <p className="pilot-privacy-hint">地址只用于本次体验，请勿填写门锁密码等敏感信息。</p>
        <button className="demo-optional-toggle" type="button" aria-expanded={showNotes} onClick={() => setShowNotes((current) => !current)}>补充服务备注（选填）</button>
        {showNotes && <label>服务备注<textarea value={draft.notes} maxLength={500} onChange={(event) => change('notes', event.target.value)} placeholder="例如宠物习惯、用品位置"/></label>}
        <div className="demo-booking-actions"><button type="button" onClick={() => setStep(1)}>返回</button><button className="primary" type="button" disabled={!visitStepComplete} onClick={() => setStep(3)}>下一步：确认预约</button></div>
      </div>}

      {step === 3 && <div className="demo-booking-step wide">
        <dl className="demo-booking-summary">
          <div><dt>服务</dt><dd>{draft.serviceType === 'CAT_FEEDING' ? '上门喂猫 · ¥32' : '上门遛狗 · ¥37'}</dd></div>
          <div><dt>宠物</dt><dd>{draft.petName}</dd></div>
          <div><dt>地址</dt><dd>{draft.district} · {draft.address}</dd></div>
          <div><dt>时间</dt><dd>{draft.scheduledAt.replace('T', ' ')}</dd></div>
          {draft.notes && <div><dt>备注</dt><dd>{draft.notes}</dd></div>}
        </dl>
        <p className="pilot-privacy-hint">提交后由平台匹配已认证服务人员；此处为功能演示，不会形成真实订单或费用。</p>
        <div className="demo-booking-actions"><button type="button" onClick={() => setStep(2)}>返回修改</button><button className="primary" type="submit">提交订单</button></div>
      </div>}
    </form><h3>我的订单</h3><div className="orders">{props.state.orders.length === 0 ? <div className="empty">还没有订单，请先提交一次服务需求。</div> : [...props.state.orders].reverse().map((order) => <OrderCard key={order.id} order={order} providerName={props.state.providers.find((item) => item.id === order.providerId)?.name} confirm={() => props.confirm(order.id)}/>)}</div>
  </section>;
}
