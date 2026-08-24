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

  return <section className="public-quote" aria-label="体验报价">
    <div>
      <span className="eyebrow">EXPERIENCE QUOTE</span>
      <h2>体验报价</h2>
      <p>体验参考价，不会产生真实费用</p>
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
      <div className="quote-summary" role="status" aria-live="polite"><span>体验参考价 / 次</span><strong>{quote.priceLabel}</strong></div>
      <button className="quote-action" onClick={onStartOrder}>按此方案体验下单</button>
    </div>
  </section>;
}
