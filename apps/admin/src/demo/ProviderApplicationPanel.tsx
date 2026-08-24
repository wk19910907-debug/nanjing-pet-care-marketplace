import { useState, type FormEvent } from 'react';
import type { ProviderApplication, ProviderApplicationDraft, ServiceType } from './workflow.js';

const districts = ['建邺区', '鼓楼区', '玄武区', '秦淮区'];
const emptyDraft: ProviderApplicationDraft = {
  name: '',
  district: '建邺区',
  services: [],
  experience: '',
};

export function ProviderApplicationPanel(props: {
  applications: readonly ProviderApplication[];
  submit(draft: ProviderApplicationDraft): boolean;
}) {
  const [draft, setDraft] = useState<ProviderApplicationDraft>(emptyDraft);
  const change = <K extends keyof ProviderApplicationDraft>(key: K, value: ProviderApplicationDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const toggleService = (service: ServiceType, checked: boolean) => {
    change('services', checked ? [...draft.services, service] : draft.services.filter((item) => item !== service));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (props.submit(draft)) setDraft(emptyDraft);
  };

  return <section className="provider-application" aria-label="申请成为服务人员">
    <div className="section-title"><div><span className="eyebrow">PROVIDER APPLICATION</span><h2>申请成为服务人员</h2></div><p>仅填写体验所需的服务信息，不收集个人身份或联系方式。</p></div>
    <form className="application-form" onSubmit={submit}>
      <label>体验昵称<input value={draft.name} onChange={(event) => change('name', event.target.value)} placeholder="例如：小林" /></label>
      <label>服务区域<select value={draft.district} onChange={(event) => change('district', event.target.value)}>{districts.map((district) => <option key={district}>{district}</option>)}</select></label>
      <fieldset className="service-choice-group"><legend>可提供的服务</legend><label className="check"><input type="checkbox" checked={draft.services.includes('CAT_FEEDING')} onChange={(event) => toggleService('CAT_FEEDING', event.target.checked)} />上门喂猫</label><label className="check"><input type="checkbox" checked={draft.services.includes('DOG_WALKING')} onChange={(event) => toggleService('DOG_WALKING', event.target.checked)} />上门遛狗</label></fieldset>
      <label className="wide">经验说明<textarea value={draft.experience} onChange={(event) => change('experience', event.target.value)} placeholder="简要说明可提供的服务经验和注意事项" /></label>
      <button className="primary wide" type="submit">提交审核申请</button>
    </form>
    <div className="application-list" aria-live="polite">
      {props.applications.length === 0 ? <div className="empty">提交后会在这里查看审核状态。</div> : [...props.applications].reverse().map((application) => <article className="application-card" key={application.id}><div><strong>{application.name} · {application.district}</strong><p>{application.services.map((service) => service === 'CAT_FEEDING' ? '上门喂猫' : '上门遛狗').join('、')}</p></div><span className="status">{application.status === 'PENDING' ? '待平台审核' : '审核通过 · 已进入匹配池'}</span></article>)}
    </div>
  </section>;
}
