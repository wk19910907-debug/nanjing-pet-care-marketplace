import { NANJING_DISTRICTS } from '@pet/contracts';
import type { PublicOperationsCatalog } from '../pilot/models.js';
import { type PublicQuoteSelection } from './publicQuote.js';
import type { ServiceType } from './workflow.js';

type PublicQuoteProps = {
  selection: PublicQuoteSelection;
  onChange: (selection: PublicQuoteSelection) => void;
  onStartOrder: () => void;
  catalog: PublicOperationsCatalog;
};

const serviceOptions: Array<{ value: ServiceType; label: string }> = [
  { value: 'CAT_FEEDING', label: '上门喂猫' },
  { value: 'DOG_WALKING', label: '上门遛狗' },
];

function price(value: number): string {
  return `¥${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value / 100)}`;
}

export function PublicQuote({ selection, onChange, onStartOrder, catalog }: PublicQuoteProps) {
  const availableServices = serviceOptions.filter(({ value }) => catalog.services[value].enabled);
  const selectedService = availableServices.some(({ value }) => value === selection.serviceType)
    ? selection.serviceType
    : availableServices[0]?.value;
  const availableDistricts = catalog.openDistricts.map((code) => (
    NANJING_DISTRICTS.find((district) => district.code === code)!.name
  ));
  const selectedDistrict = availableDistricts.includes(selection.district)
    ? selection.district
    : availableDistricts[0];

  if (!selectedService || !selectedDistrict) {
    return <section className="public-quote" aria-label="预约参考"><p>服务配置暂不可用，请稍后重试。</p></section>;
  }

  return <section className="public-quote" aria-label="预约参考">
    <div>
      <span className="eyebrow">预约参考</span>
      <h2>看看你的服务起步价</h2>
      <p>最终价格以预约确认页的服务器报价为准</p>
    </div>
    <div className="quote-controls">
      <label>服务类型
        <select value={selectedService} onChange={(event) => onChange({ serviceType: event.target.value as ServiceType, district: selectedDistrict })}>
          {availableServices.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>服务区域
        <select value={selectedDistrict} onChange={(event) => onChange({ serviceType: selectedService, district: event.target.value as PublicQuoteSelection['district'] })}>
          {availableDistricts.map((district) => <option key={district} value={district}>{district}</option>)}
        </select>
      </label>
    </div>
    <div className="quote-decision">
      <div className="quote-summary" role="status" aria-live="polite"><span>服务起步价 / 次</span><strong>{price(catalog.services[selectedService].basePriceFen)}</strong></div>
      <button className="quote-action" onClick={() => { onChange({ serviceType: selectedService, district: selectedDistrict }); onStartOrder(); }}>按此服务立即预约</button>
    </div>
  </section>;
}
