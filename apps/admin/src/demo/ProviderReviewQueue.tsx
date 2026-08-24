import type { ProviderApplication } from './workflow.js';

const serviceLabels = {
  CAT_FEEDING: '上门喂猫',
  DOG_WALKING: '上门遛狗',
} as const;

export function ProviderReviewQueue(props: { applications: readonly ProviderApplication[]; approve(applicationId: string): void }) {
  return <section className="review-queue" aria-label="服务人员审核队列">
    <div className="section-title"><div><span className="eyebrow">REVIEW</span><h3>服务人员审核</h3></div><p>审核通过后，人员才会进入相应区域和服务的匹配池。</p></div>
    <div className="application-list">{props.applications.length === 0 ? <div className="empty">暂无服务人员申请。</div> : [...props.applications].reverse().map((application) => <article className="application-card" key={application.id}>
      <div><strong>{application.name} · {application.district}</strong><p>{application.services.map((service) => serviceLabels[service]).join('、')} · {application.experience}</p></div>
      {application.status === 'PENDING' ? <button onClick={() => props.approve(application.id)}>审核通过：{application.name}</button> : <span className="review-status">审核通过 · 已进入匹配池</span>}
    </article>)}</div>
  </section>;
}
