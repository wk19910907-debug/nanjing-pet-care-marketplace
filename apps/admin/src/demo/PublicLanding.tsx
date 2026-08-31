import type { ReactNode } from 'react';
import { PublicQuote } from './PublicQuotePanel.js';
import type { PublicQuoteSelection } from './publicQuote.js';
import type { PublicOperationsCatalog, ServiceType } from '../pilot/models.js';
import { PetIcon } from './PetIcon.js';

type PublicLandingProps = {
  children: ReactNode;
  onStartOrder: () => void;
  onQuoteStartOrder: (selection?: PublicQuoteSelection) => void;
  onViewOrders?: () => void;
  quoteSelection: PublicQuoteSelection;
  onQuoteChange: (selection: PublicQuoteSelection) => void;
  catalog: PublicOperationsCatalog | null;
};

const services: ReadonlyArray<{
  type: ServiceType; title: string; copy: string; action: string;
}> = [
  { type: 'CAT_FEEDING', title: '上门喂猫', copy: '喂食换水、猫砂清理、宠物状态反馈。', action: '预约喂猫' },
  { type: 'DOG_WALKING', title: '上门遛狗', copy: '牵引散步、饮水照看、服务状态反馈。', action: '预约遛狗' },
];

function startingPrice(value: number): string {
  return `¥${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value / 100)} 起`;
}

const safeguards = [
  ['身份资料审核', '服务人员提交身份与服务资料，通过平台审核后进入匹配范围。'],
  ['平台统一匹配', '宠主提交需求后，由平台根据区域、时间与服务能力安排人员。'],
  ['订单状态可查', '从等待匹配到服务完成，每一步都在订单中清晰展示。'],
  ['服务过程留痕', '服务清单、现场记录和完成报告形成可回看的履约过程。'],
] as const;

const processSteps = [
  ['01', '提交预约', '选择服务与时间，补充宠物和上门信息。'],
  ['02', '平台匹配', '平台核对需求并安排合适的服务人员。'],
  ['03', '上门服务', '服务人员按订单清单完成照护并记录过程。'],
  ['04', '查看记录', '宠主查看报告并确认本次服务结果。'],
] as const;

export function PublicLanding({ catalog, children, onStartOrder, onViewOrders, onQuoteStartOrder, quoteSelection, onQuoteChange }: PublicLandingProps) {
  const availableServices = catalog
    ? services.filter(({ type }) => catalog.services[type].enabled)
    : [];
  const bookingAvailable = availableServices.length > 0;
  return <div className="customer-web">
    <nav className="public-nav" aria-label="官网导航">
      <a className="public-brand" href="#top"><span aria-hidden="true"><PetIcon type="CAT_FEEDING"/></span><strong>南京安心宠</strong><small>南京</small></a>
      <div><a href="#services">服务介绍</a><a href="#safeguards">服务保障</a><button className="header-orders" type="button" onClick={onViewOrders ?? onStartOrder}>我的订单</button><button className="header-booking" type="button" disabled={!bookingAvailable} onClick={onStartOrder}>立即预约</button></div>
    </nav>

    <section id="top" className="hero public-hero">
      <div className="public-hero-copy">
        <span className="eyebrow">南京上门宠物照护</span>
        <h1>出门放心，宠物在家也被认真照顾</h1>
        <p>南京上门喂猫、上门遛狗服务。提交需求后，由平台匹配合适的服务人员。</p>
        <div className="public-hero-actions"><button className="hero-cta" disabled={!bookingAvailable} onClick={onStartOrder}>立即预约</button><a href="#process">了解服务流程</a></div>
        <ul className="public-trust-line"><li>身份审核</li><li>平台匹配</li><li>服务留痕</li></ul>
      </div>
      <div className="pet-companions" aria-hidden="true">
        <div><PetIcon type="CAT_FEEDING"/><span>安心在家</span></div>
        <div><PetIcon type="DOG_WALKING"/><span>自在散步</span></div>
      </div>
    </section>

    {catalog?.announcement && <p className="public-announcement" role="status">{catalog.announcement}</p>}

    <section id="services" className="landing-section public-services" aria-labelledby="services-title">
      <span className="eyebrow">核心服务</span>
      <h2 id="services-title">只做两件事，把每次上门做好</h2>
      <p className="section-lead">参考起步价清晰展示，最终价格以预约确认页的服务器报价为准。</p>
      <div className="price-grid">
        {availableServices.map((service) => <article className="price-card" key={service.type}><span className="service-icon" aria-hidden="true"><PetIcon type={service.type}/></span><div><h3>{service.title}</h3><p>{service.copy}</p></div><strong>{startingPrice(catalog!.services[service.type].basePriceFen)}</strong><button type="button" onClick={() => { const selection = { ...quoteSelection, serviceType: service.type }; onQuoteChange(selection); onQuoteStartOrder(selection); }}>{service.action}</button></article>)}
        {!bookingAvailable && <p className="pilot-empty">服务配置暂不可用，请稍后重试。</p>}
      </div>
      {catalog && <details className="optional-pricing"><summary>查看区域与参考价格</summary><PublicQuote catalog={catalog} selection={quoteSelection} onChange={onQuoteChange} onStartOrder={onQuoteStartOrder}/></details>}
    </section>

    {children}

    <section id="process" className="landing-section public-process" aria-labelledby="process-title">
      <span className="eyebrow">服务流程</span><h2 id="process-title">从提交需求到查看记录</h2>
      <div className="process-grid">{processSteps.map(([number, title, copy]) => <article key={number}><span>{number}</span><strong>{title}</strong><p>{copy}</p></article>)}</div>
    </section>

    <section id="safeguards" className="landing-section safeguards" aria-labelledby="safeguards-title">
      <span className="eyebrow">平台保障</span><h2 id="safeguards-title">匹配和服务过程都有交代</h2>
      <div className="safeguard-grid">{safeguards.map(([title, copy]) => <article key={title}><span aria-hidden="true">✓</span><strong>{title}</strong><p>{copy}</p></article>)}</div>
    </section>

    <section id="faq" className="landing-section faq" aria-labelledby="faq-title">
      <span className="eyebrow">常见问题</span><h2 id="faq-title">预约前想了解的事</h2>
      <details><summary>目前提供哪些服务？</summary><p>首期只提供上门喂猫与上门遛狗，其他需求暂不承接。</p></details>
      <details><summary>平台如何安排服务人员？</summary><p>宠主提交需求后，由平台根据服务区域、预约时间和服务能力统一匹配，不开放自主选人。</p></details>
      <details><summary>价格如何确定？</summary><p>页面显示起步价，提交前会展示服务器生成的最终报价。</p></details>
      <details><summary>南京哪些区域可以预约？</summary><p>可在预约页选择当前开放区域，是否能在指定时间接单以平台确认结果为准。</p></details>
    </section>
    <nav className="customer-quick-nav" aria-label="快捷导航"><a href="#top">首页</a><button type="button" disabled={!bookingAvailable} onClick={onStartOrder}>预约服务</button><button type="button" onClick={onViewOrders ?? onStartOrder}>我的订单</button></nav>
  </div>;
}
