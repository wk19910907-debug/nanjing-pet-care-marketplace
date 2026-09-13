import { useState, type PointerEvent, type ReactNode } from 'react';
import catCareAvif from '../assets/cat-care-card.avif';
import catCareWebp from '../assets/cat-care-card.webp';
import dogWalkAvif from '../assets/dog-walk-card.avif';
import dogWalkWebp from '../assets/dog-walk-card.webp';
import heroAvif from '../assets/premium-care-hero.avif';
import heroWebp from '../assets/premium-care-hero.webp';
import type { PublicOperationsCatalog, ServiceType } from '../pilot/models.js';
import { CommerceIcon, type CommerceIconName } from './CommerceIcon.js';
import { calculateHeroParallax } from './heroMotion.js';
import { DEMO_PRICE_NOTE, PublicQuote } from './PublicQuotePanel.js';
import type { PublicQuoteSelection } from './publicQuote.js';

type PublicLandingProps = {
  pricingSource: 'demo' | 'server';
  children: ReactNode;
  footerContent?: ReactNode;
  onStartOrder: () => void;
  onQuoteStartOrder: (selection?: PublicQuoteSelection) => void;
  bookingPending?: boolean;
  onViewOrders?: () => void;
  onReloadCatalog?: () => void;
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
  careSteps: readonly string[];
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
    duration: '约 30 分钟',
    details: ['喂食换水', '猫砂清理', '状态反馈'],
    careSteps: ['确认宠物数量', '添加猫粮与饮水', '清理猫砂', '提交现场服务记录'],
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
    careSteps: ['检查并扣好牵引绳', '按订单约定时长散步', '记录本次遛狗时长', '提交现场服务记录'],
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
  pricingSource,
  catalog,
  children,
  footerContent,
  onStartOrder,
  onViewOrders,
  onReloadCatalog,
  onQuoteStartOrder,
  bookingPending = false,
  quoteSelection,
  onQuoteChange,
}: PublicLandingProps) {
  const [viewedServiceType, setViewedServiceType] = useState<ServiceType>(quoteSelection.serviceType);
  const availableServices = catalog
    ? services.filter(({ type }) => catalog.services[type].enabled)
    : [];
  const bookingAvailable = availableServices.length > 0;
  const viewedService = availableServices.find(({ type }) => type === viewedServiceType) ?? availableServices[0];
  const viewOrders = onViewOrders ?? onStartOrder;
  const startService = (type: ServiceType) => {
    setViewedServiceType(type);
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
      <a className="store-brand" href="#top">
        <span className="store-brand-mark" aria-hidden="true"><CommerceIcon name="cat"/></span>
        <span className="store-brand-name"><strong>安心宠</strong><small>上门宠物照护</small></span>
      </a>
      <button className="store-search-cta" type="button" disabled={!bookingAvailable || bookingPending} onClick={onStartOrder}>
        上门服务 · 选择时间 <CommerceIcon name="arrow"/>
      </button>
      <div className="store-nav-links">
        <a href="#services">上门服务</a>
        <a href="#process">服务流程</a>
        <a href="#safeguards">安心保障</a>
        <a href="#lost-pet">寻宠帮助</a>
        <button className="header-orders" type="button" onClick={viewOrders}>我的订单</button>
        <button className="header-booking" type="button" disabled={!bookingAvailable || bookingPending} onClick={onStartOrder}>{bookingPending ? '正在开启…' : '立即预约'}</button>
      </div>
    </nav>

    <main id="top" className="store-main">
      <section className="store-hero">
        <div className="store-hero-copy">
          <span className="store-kicker">安心宠 · 上门照护</span>
          <h1>上门照顾好，<br/>让牵挂少一点</h1>
          <p>喂猫、遛狗，选好服务和时间。后续由平台确认需求、匹配服务人员。</p>
          <button className="store-primary" disabled={!bookingAvailable || bookingPending} onClick={onStartOrder}>
            {bookingPending ? '正在开启…' : '立即预约'} <CommerceIcon name="arrow"/>
          </button>
          <p className="store-hero-note">服务人员由平台安排 · 订单进度可查看</p>
        </div>
        <picture className="store-hero-media" onPointerMove={moveHeroMedia} onPointerLeave={resetHeroMedia}>
          <source srcSet={heroAvif} type="image/avif"/>
          <img src={heroWebp} width="1600" height="1000" alt="猫和狗在明亮整洁的家中休息"/>
        </picture>
      </section>

      {viewedService && <section className="store-finder" aria-label="预约服务">
        <div className="store-finder-intro"><span className="store-kicker">上门照护</span><strong>选好服务，其余交给我们</strong><p>平台安排服务人员</p></div>
        <div className="store-finder-actions">
          <div className="store-finder-tabs" role="tablist" aria-label="选择上门服务">
            {availableServices.map((service) => <button type="button" role="tab" key={service.type}
              aria-selected={viewedService.type === service.type} onClick={() => setViewedServiceType(service.type)}>{service.title}</button>)}
          </div>
          <div className="store-finder-submit"><span>下一步选择上门时间</span><button type="button" disabled={bookingPending} onClick={() => startService(viewedService.type)}>选择时间并预约{viewedService.title} <CommerceIcon name="arrow"/></button></div>
        </div>
      </section>}

      <nav className="store-quick-categories" aria-label="服务快捷入口">
        {availableServices.map((service) => <button type="button" key={service.type} disabled={bookingPending} onClick={() => startService(service.type)}>
          <span aria-hidden="true"><CommerceIcon name={service.icon}/></span><strong>{service.title}</strong><small>{service.duration}</small>
        </button>)}
        <a href="#lost-pet"><span aria-hidden="true"><CommerceIcon name="search"/></span><strong>寻宠帮助</strong><small>整理线索</small></a>
        <button type="button" onClick={viewOrders}><span aria-hidden="true"><CommerceIcon name="orders"/></span><strong>我的订单</strong><small>查进度</small></button>
      </nav>

      {catalog?.announcement && <p className="public-announcement" role="status">{catalog.announcement}</p>}

      <section id="services" className="landing-section store-services" aria-labelledby="services-title">
        <header className="store-section-heading">
          <div><span className="store-kicker">选择服务</span><h2 id="services-title">先选一项服务</h2></div>
          <p>目前只做上门喂猫和遛狗。点选后填写时间与必要信息即可。</p>
        </header>
        <div className="store-product-grid">
          {availableServices.map((service) => <article className="store-product-card" key={service.type}>
            <picture className="store-product-media">
              <source srcSet={service.imageAvif} type="image/avif"/>
              <img src={service.imageWebp} width="960" height="720" alt={service.imageAlt} loading="lazy"/>
            </picture>
            <div className="store-product-content">
              <span className="store-product-label">上门照护 · {service.duration}</span>
              <div className="store-product-title"><h3>{service.title}</h3><strong>{startingPrice(catalog!.services[service.type].basePriceFen)}</strong></div>
              <p>{service.copy}</p>
              <ul>{service.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
              <button type="button" disabled={bookingPending} onClick={() => startService(service.type)}>
                预约{service.title} <CommerceIcon name="arrow"/>
              </button>
            </div>
          </article>)}
          {!bookingAvailable && <div className="store-catalog-empty"><p className="pilot-empty">服务配置暂不可用，请稍后重试。</p>{onReloadCatalog && <button type="button" onClick={onReloadCatalog}>重新加载服务</button>}</div>}
        </div>
        <p className="store-price-note">{pricingSource === 'demo' ? DEMO_PRICE_NOTE : '最终价格以确认预约时的服务器报价为准'}</p>
        {catalog && <details className="optional-pricing"><summary>查看区域与参考价格</summary><PublicQuote pricingSource={pricingSource} catalog={catalog} selection={quoteSelection} onChange={onQuoteChange} onStartOrder={onQuoteStartOrder}/></details>}
      </section>

      {viewedService && <section className="landing-section store-care-content" aria-label="服务内容">
        <div className="store-care-heading"><span className="store-kicker">服务内容</span><h2 id="care-content-title">上门服务具体做什么</h2><p>先看清服务范围，再选择适合宠物的一项。实际安排以订单确认结果为准。</p></div>
        <div className="store-care-tabs" role="tablist" aria-label="查看服务内容">
          {availableServices.map((service) => <button key={service.type} type="button" role="tab"
            aria-selected={viewedService.type === service.type} onClick={() => setViewedServiceType(service.type)}>{service.title}</button>)}
        </div>
        <div className="store-care-panel" role="tabpanel">
          <div><span className="store-product-label">{viewedService.duration} · 平台匹配服务人员</span><h3>{viewedService.title}</h3><p>{viewedService.copy}</p>
            <ol>{viewedService.careSteps.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, '0')}</span>{step}</li>)}</ol>
            <button type="button" className="store-care-book" disabled={bookingPending} onClick={() => startService(viewedService.type)}>查看时间并预约{viewedService.title} <CommerceIcon name="arrow"/></button>
          </div>
          <picture><source srcSet={viewedService.imageAvif} type="image/avif"/><img src={viewedService.imageWebp} width="960" height="720" alt={viewedService.imageAlt} loading="lazy"/></picture>
        </div>
      </section>}

      <section id="lost-pet" className="landing-section store-lost-pet" aria-label="寻宠帮助">
        <div className="store-lost-heading"><span className="store-kicker">寻宠帮助</span><h2>宠物走失，先把线索整理清楚</h2><p>越早记录关键信息，越方便向物业、邻居和附近宠物群求助。</p></div>
        <div className="store-lost-steps">
          <article><span>01</span><strong>确认最后线索</strong><p>记录最后出现的时间与大致区域，先查看附近通道、监控和常去地点。</p></article>
          <article><span>02</span><strong>准备清晰照片</strong><p>选近期正面与全身照片，写明宠物特征、是否胆小及辨认方式。</p></article>
          <article><span>03</span><strong>发布寻宠信息</strong><p>制作便于转发的寻宠启事，向物业、邻居和可信的本地群组同步线索。</p></article>
        </div>
        <p className="store-lost-safety">寻宠信息整理不能替代线下寻找，也不保证找回。公开启事不要公开门牌号、门锁信息或其他敏感资料；联系方式仅向可信渠道提供。</p>
      </section>

      {children}

      <section id="process" className="landing-section public-process store-process" aria-labelledby="process-title">
        <span className="store-kicker">服务流程</span><h2 id="process-title">从提交需求到查看记录</h2>
        <div className="process-grid">{processSteps.map(([number, title, copy]) => <article key={number}><span>{number}</span><strong>{title}</strong><p>{copy}</p></article>)}</div>
      </section>

      <section id="safeguards" className="landing-section safeguards store-safeguards" aria-labelledby="safeguards-title">
        <span className="store-kicker">安心保障</span><h2 id="safeguards-title">每一次匹配和服务，都有清晰交代</h2>
        <div className="safeguard-grid">{safeguards.map(([title, copy]) => <article key={title}><span aria-hidden="true"><CommerceIcon name="verified"/></span><strong>{title}</strong><p>{copy}</p></article>)}</div>
      </section>

      <section id="faq" className="landing-section faq store-faq" aria-labelledby="faq-title">
        <span className="store-kicker">常见问题</span><h2 id="faq-title">预约前想了解的事</h2>
        <details><summary>目前提供哪些服务？</summary><p>首期只提供上门喂猫与上门遛狗，其他需求暂不承接。</p></details>
        <details><summary>平台如何安排服务人员？</summary><p>宠主提交需求后，由平台根据服务区域、预约时间和服务能力统一匹配，服务人员由平台安排。</p></details>
        <details><summary>价格如何确定？</summary><p>{pricingSource === 'demo' ? DEMO_PRICE_NOTE : '页面显示起步价，提交前会展示服务器生成的最终报价。'}</p></details>
        <details><summary>哪些区域可以预约？</summary><p>可在预约页选择当前开放区域，是否能在指定时间接单以平台确认结果为准。</p></details>
      </section>
    </main>

    <footer className="store-footer">
      <a className="store-brand" href="#top"><span className="store-brand-mark" aria-hidden="true"><CommerceIcon name="cat"/></span><span className="store-brand-name"><strong>安心宠</strong><small>上门宠物照护</small></span></a>
      <p>{pricingSource === 'demo' ? '当前为功能演示，不会形成真实订单。请勿填写真实个人信息。' : '服务范围与价格以预约确认结果为准。请勿填写门锁密码等敏感信息。'}</p>
      <nav aria-label="页脚导航"><a href="#services">服务</a><a href="#lost-pet">寻宠帮助</a><a href="#safeguards">保障</a><a href="#faq">常见问题</a></nav>
      {footerContent}
    </footer>

    <nav className="customer-quick-nav" aria-label="快捷导航">
      <a href="#top"><CommerceIcon name="cat"/><span>首页</span></a>
      <a href="#services"><CommerceIcon name="dog"/><span>服务</span></a>
      <button type="button" disabled={!bookingAvailable || bookingPending} onClick={onStartOrder}><CommerceIcon name="arrow"/><span>预约</span></button>
      <a href="#lost-pet"><CommerceIcon name="search"/><span>寻宠</span></a>
      <button type="button" onClick={viewOrders}><CommerceIcon name="orders"/><span>订单</span></button>
    </nav>
  </div>;
}
