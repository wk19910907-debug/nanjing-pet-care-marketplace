import { PUBLIC_DISTRICTS, getPublicQuote, type PublicQuoteSelection } from './publicQuote.js';
import type { ServiceType } from './workflow.js';

type PublicQuoteProps = {
  selection: PublicQuoteSelection;
  onChange: (selection: PublicQuoteSelection) => void;
  onStartOrder: () => void;
};

const serviceOptions: Array<{ value: ServiceType; label: string }> = [
  { value: 'CAT_FEEDING', label: '上门喂猫' },
  { value: 'DOG_WALKING', label: '上门遛狗' },
];

export function PublicQuote({ selection, onChange, onStartOrder }: PublicQuoteProps) {
  const quote = getPublicQuote(selection.serviceType);

  return <section className="public-quote" aria-label="预约参考">
    <div>
      <span className="eyebrow">预约参考</span>
      <h2>看看你的服务起步价</h2>
      <p>最终价格以预约确认页的服务器报价为准</p>
    </div>
    <div className="quote-controls">
      <label>服务类型
        <select value={selection.serviceType} onChange={(event) => onChange({ ...selection, serviceType: event.target.value as ServiceType })}>
          {serviceOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>服务区域
        <select value={selection.district} onChange={(event) => onChange({ ...selection, district: event.target.value as PublicQuoteSelection['district'] })}>
          {PUBLIC_DISTRICTS.map((district) => <option key={district} value={district}>{district}</option>)}
        </select>
      </label>
    </div>
    <div className="quote-decision">
      <div className="quote-summary" role="status" aria-live="polite"><span>服务起步价 / 次</span><strong>{quote.priceLabel}</strong></div>
      <button className="quote-action" onClick={onStartOrder}>按此服务立即预约</button>
    </div>
  </section>;
}
