import type { ReactNode } from 'react';
import { PublicQuote } from './PublicQuote.tsx';
import type { PublicQuoteSelection } from './publicQuote.js';

type PublicLandingProps = {
  children: ReactNode;
  onStartOrder: () => void;
  onQuoteStartOrder: () => void;
  quoteSelection: PublicQuoteSelection;
  onQuoteChange: (selection: PublicQuoteSelection) => void;
};

const safeguards = [
  ['人员审核机制', '产品已设计资料审核与权限分级；公开体验使用演示人员。'],
  ['平台统一匹配', '宠主提交需求后，由平台视角选择合适人员，不公开联系方式。'],
  ['留痕服务报告', '服务清单、状态记录与宠主确认形成可回看的履约过程。'],
  ['异常订单处理', '产品已设计投诉冻结与退款流程；正式运营前仍需配备真实客服资源。'],
] as const;

export function PublicLanding({ children, onStartOrder, onQuoteStartOrder, quoteSelection, onQuoteChange }: PublicLandingProps) {
  return <>
    <section className="hero">
      <div>
        <span className="eyebrow">MANAGED PET CARE · NANJING</span>
        <h1>把每一次上门服务<br />交给平台认真匹配</h1>
        <p>宠主只需提交订单，平台负责匹配人员并跟进上门履约。当前为安全体验版，不产生真实订单或费用。</p>
        <button className="hero-cta" onClick={onStartOrder}>立即体验下单</button>
      </div>
      <div className="flow-card"><span>服务闭环</span><strong>下单 → 匹配 → 上门 → 报告 → 确认</strong></div>
    </section>

    <section className="landing-section" aria-labelledby="services-title">
      <span className="eyebrow">SERVICES & PRICING</span>
      <h2 id="services-title">两项核心服务，价格先说清楚</h2>
      <p className="section-lead">体验区域：建邺区、鼓楼区、玄武区、秦淮区。以下为体验参考价。</p>
      <div className="price-grid">
        <article className="price-card"><span>上门喂猫</span><strong>¥32</strong><small>体验参考价 / 次</small><p>喂食换水、清理宠物区域并提交服务记录。</p></article>
        <article className="price-card"><span>上门遛狗</span><strong>¥37</strong><small>体验参考价 / 次</small><p>按约定时段完成遛狗清单并提交状态报告。</p></article>
      </div>
      <PublicQuote selection={quoteSelection} onChange={onQuoteChange} onStartOrder={onQuoteStartOrder} />
    </section>

    <section className="landing-section safeguards" aria-labelledby="safeguards-title">
      <span className="eyebrow">PLATFORM SAFEGUARDS</span>
      <h2 id="safeguards-title">平台把匹配和履约过程管起来</h2>
      <div className="safeguard-grid">{safeguards.map(([title, copy]) => <article key={title}><strong>{title}</strong><p>{copy}</p></article>)}</div>
    </section>

    {children}

    <section className="landing-section faq" aria-labelledby="faq-title">
      <span className="eyebrow">FAQ</span>
      <h2 id="faq-title">常见问题</h2>
      <details><summary>现在提交的是真实订单吗？</summary><p>不是。公开页面用于体验产品闭环，不会通知服务人员，也不会产生费用。</p></details>
      <details><summary>体验数据保存在哪里？</summary><p>只保存在当前浏览器中，不会上传到远端服务器。</p></details>
      <details><summary>目前支持哪些区域？</summary><p>页面提供建邺区、鼓楼区、玄武区和秦淮区体验选项，不代表已经正式覆盖这些区域。</p></details>
      <details><summary>何时可以真实预约？</summary><p>正式运营还需完成真实人员审核、客服、支付、隐私合规与生产基础设施。</p></details>
    </section>
  </>;
}
