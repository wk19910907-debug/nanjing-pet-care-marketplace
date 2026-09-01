import type { PointerEvent, ReactNode } from 'react';
import catCareAvif from '../assets/cat-care-card.avif';
import catCareWebp from '../assets/cat-care-card.webp';
import dogWalkAvif from '../assets/dog-walk-card.avif';
import dogWalkWebp from '../assets/dog-walk-card.webp';
import heroAvif from '../assets/premium-care-hero.avif';
import heroWebp from '../assets/premium-care-hero.webp';
import type { PublicOperationsCatalog, ServiceType } from '../pilot/models.js';
import { CommerceIcon, type CommerceIconName } from './CommerceIcon.js';
import { calculateHeroParallax } from './heroMotion.js';
import { PublicQuote } from './PublicQuotePanel.js';
import type { PublicQuoteSelection } from './publicQuote.js';

type PublicLandingProps = {
  children: ReactNode;
  onStartOrder: () => void;
  onQuoteStartOrder: (selection?: PublicQuoteSelection) => void;
  onViewOrders?: () => void;
  quoteSelection: PublicQuoteSelection;
  onQuoteChange: (selection: PublicQuoteSelection) => void;
  catalog: PublicOperationsCatalog | null;
};

type ServicePresentation = {
  type: ServiceType;
  title: string;
  copy: string;
  duration: string;
  details: readonly string[];
  icon: CommerceIconName;
  imageAvif: string;
  imageWebp: string;
  imageAlt: string;
};

const services: readonly ServicePresentation[] = [
  {
    type: 'CAT_FEEDING',
    title: '上门喂猫',
    copy: '让猫咪留在熟悉的家，按预约清单完成基础照护。',
    duration: '约 25 分钟',
    details: ['喂食换水', '猫砂清理', '状态反馈'],
    icon: 'cat',
    imageAvif: catCareAvif,
    imageWebp: catCareWebp,
    imageAlt: '猫咪在明亮整洁的家中饮水',
  },
  {
    type: 'DOG_WALKING',
    title: '上门遛狗',
    copy: '在熟悉的社区完成牵引散步，并及时反馈服务状态。',
    duration: '约 30 分钟',
    details: ['牵引散步', '补充饮水', '状态反馈'],
    icon: 'dog',
    imageAvif: dogWalkAvif,
    imageWebp: dogWalkWebp,
    imageAlt: '佩戴牵引装备的狗狗在家中等待散步',
  },
] as const;

function startingPrice(value: number): string {
  return '¥' + new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value / 100) + ' 起';
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

export function PublicLanding({
  catalog,
  children,
  onStartOrder,
  onViewOrders,
  onQuoteStartOrder,
  quoteSelection,
  onQuoteChange,
}: PublicLandingProps) {
  const availableServices = catalog
    ? services.filter(({ type }) => catalog.services[type].enabled)
    : [];
  const bookingAvailable = availableServices.length > 0;
  const viewOrders = onViewOrders ?? onStartOrder;
  const startService = (type: ServiceType) => {
    const selection = { ...quoteSelection, serviceType: type };
    onQuoteChange(selection);
    onQuoteStartOrder(selection);
  };
  const moveHeroMedia = (event: PointerEvent<HTMLPictureElement>) => {
    if (typeof window.matchMedia !== 'function' || !window.matchMedia('(pointer: fine)').matches) return;
    const { x, y } = calculateHeroParallax(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
    event.currentTarget.style.setProperty('--hero-shift-x', `${x}px`);
    event.currentTarget.style.setProperty('--hero-shift-y', `${y}px`);
  };
  const resetHeroMedia = (event: PointerEvent<HTMLPictureElement>) => {
    event.currentTarget.style.setProperty('--hero-shift-x', '0px');
    event.currentTarget.style.setProperty('--hero-shift-y', '0px');
  };

  return <div className="customer-web">
    <nav className="public-nav store-nav" aria-label="官网导航">
      <a className="public-brand store-brand" href="#top">
        <span className="store-brand-mark" aria-hidden="true"><CommerceIcon name="cat"/></span>
        <span><strong>安心宠</strong><small>PET CARE · NANJING</small></span>
      </a>
      <div className="store-nav-links">
        <a href="#services">上门服务</a>
        <a href="#process">服务流程</a>
        <a href="#safeguards">安心保障</a>
        <button className="header-orders" type="button" onClick={viewOrders}>我的订单</button>
        <button className="header-booking" type="button" disabled={!bookingAvailable} onClick={onStartOrder}>立即预约</button>
      </div>
    </nav>

    <main>
      <section id="top" className="store-hero">
        <div className="store-hero-copy">
          <span className="store-kicker">PREMIUM PET CARE · NANJING</span>
          <h1>熟悉的家，安心的照护</h1>
          <p>南京上门喂猫与遛狗服务。提交需求后，由平台匹配经过资料审核的服务人员。</p>
          <button className="store-primary" disabled={!bookingAvailable} onClick={onStartOrder}>
            探索上门服务 <CommerceIcon name="arrow"/>
          </button>
          <ul className="store-trust"><li>身份资料审核</li><li>平台统一匹配</li><li>服务过程留痕</li></ul>
        </div>
        <picture className="store-hero-media" onPointerMove={moveHeroMedia} onPointerLeave={resetHeroMedia}>
          <source srcSet={heroAvif} type="image/avif"/>
          <img src={heroWebp} width="1600" height="1000" alt="猫和狗在明亮整洁的家中休息"/>
        </picture>
      </section>

      {catalog?.announcement && <p className="public-announcement" role="status">{catalog.announcement}</p>}

      <nav className="store-quick-categories" aria-label="服务快捷入口">
        <button type="button" disabled={!catalog?.services.CAT_FEEDING.enabled} aria-label="快捷预约上门喂猫" onClick={() => startService('CAT_FEEDING')}>
          <span><CommerceIcon name="cat"/></span><strong>上门喂猫</strong><small>日常照护</small>
        </button>
        <button type="button" disabled={!catalog?.services.DOG_WALKING.enabled} aria-label="快捷预约上门遛狗" onClick={() => startService('DOG_WALKING')}>
          <span><CommerceIcon name="dog"/></span><strong>上门遛狗</strong><small>自在散步</small>
        </button>
        <a href="#safeguards"><span><CommerceIcon name="verified"/></span><strong>安心保障</strong><small>过程留痕</small></a>
        <button type="button" onClick={viewOrders}><span><CommerceIcon name="orders"/></span><strong>我的订单</strong><small>进度可查</small></button>
      </nav>

      <section id="services" className="landing-section store-services" aria-labelledby="services-title">
        <header className="store-section-heading">
          <div><span className="store-kicker">CURATED SERVICES</span><h2 id="services-title">为日常离家时刻，准备两项专业照护</h2></div>
          <p>服务项目保持简单，预约信息尽量精简。平台依据区域、时间与需求统一匹配人员。</p>
        </header>
        <div className="store-product-grid">
          {availableServices.map((service) => <article className="store-product-card" key={service.type}>
            <picture className="store-product-media">
              <source srcSet={service.imageAvif} type="image/avif"/>
              <img src={service.imageWebp} width="960" height="720" alt={service.imageAlt} loading="lazy"/>
              <span>{service.duration}</span>
            </picture>
            <div className="store-product-content">
              <span className="store-product-label">NANJING HOME SERVICE</span>
              <div className="store-product-title"><h3>{service.title}</h3><strong>{startingPrice(catalog!.services[service.type].basePriceFen)}</strong></div>
              <p>{service.copy}</p>
              <ul>{service.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
              <button type="button" onClick={() => startService(service.type)}>
                预约{service.title} <CommerceIcon name="arrow"/>
              </button>
            </div>
          </article>)}
          {!bookingAvailable && <p className="pilot-empty">服务配置暂不可用，请稍后重试。</p>}
        </div>
        <p className="store-price-note">最终价格以确认预约时的服务器报价为准</p>
        {catalog && <details className="optional-pricing"><summary>查看区域与参考价格</summary><PublicQuote catalog={catalog} selection={quoteSelection} onChange={onQuoteChange} onStartOrder={onQuoteStartOrder}/></details>}
      </section>

      {children}

      <section id="process" className="landing-section public-process store-process" aria-labelledby="process-title">
        <span className="store-kicker">HOW IT WORKS</span><h2 id="process-title">从提交需求到查看记录</h2>
        <div className="process-grid">{processSteps.map(([number, title, copy]) => <article key={number}><span>{number}</span><strong>{title}</strong><p>{copy}</p></article>)}</div>
      </section>

      <section id="safeguards" className="landing-section safeguards store-safeguards" aria-labelledby="safeguards-title">
        <span className="store-kicker">CARE STANDARD</span><h2 id="safeguards-title">每一次匹配和服务，都有清晰交代</h2>
        <div className="safeguard-grid">{safeguards.map(([title, copy]) => <article key={title}><span aria-hidden="true"><CommerceIcon name="verified"/></span><strong>{title}</strong><p>{copy}</p></article>)}</div>
      </section>

      <section id="faq" className="landing-section faq store-faq" aria-labelledby="faq-title">
        <span className="store-kicker">SERVICE NOTES</span><h2 id="faq-title">预约前想了解的事</h2>
        <details><summary>目前提供哪些服务？</summary><p>首期只提供上门喂猫与上门遛狗，其他需求暂不承接。</p></details>
        <details><summary>平台如何安排服务人员？</summary><p>宠主提交需求后，由平台根据服务区域、预约时间和服务能力统一匹配，服务人员由平台安排。</p></details>
        <details><summary>价格如何确定？</summary><p>页面显示起步价，提交前会展示服务器生成的最终报价。</p></details>
        <details><summary>南京哪些区域可以预约？</summary><p>可在预约页选择当前开放区域，是否能在指定时间接单以平台确认结果为准。</p></details>
      </section>
    </main>

    <footer className="store-footer">
      <a className="store-brand" href="#top"><span className="store-brand-mark" aria-hidden="true"><CommerceIcon name="cat"/></span><span><strong>安心宠</strong><small>PET CARE · NANJING</small></span></a>
      <p>南京上门喂猫与遛狗服务 · 页面为试运营信息展示，服务范围与价格以预约确认结果为准。</p>
      <nav aria-label="页脚导航"><a href="#services">服务</a><a href="#safeguards">保障</a><a href="#faq">常见问题</a></nav>
    </footer>

    <nav className="customer-quick-nav" aria-label="快捷导航">
      <a href="#top">首页</a>
      <button type="button" disabled={!bookingAvailable} onClick={onStartOrder}>预约服务</button>
      <button type="button" onClick={viewOrders}>我的订单</button>
    </nav>
  </div>;
}
