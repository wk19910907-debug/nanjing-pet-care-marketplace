import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { PILOT_DISTRICTS } from '../districts.js';
import type { OwnerAddress, OwnerPet, QuoteBreakdown, ServiceType } from '../models.js';
import {
  bookingStepIsComplete,
  nextBookingStep,
  previousBookingStep,
  selectBookingService,
  type BookingDraft,
  type BookingStep,
} from './booking.js';

type BookingFlowProps = {
  draft: BookingDraft;
  setDraft: Dispatch<SetStateAction<BookingDraft>>;
  pets: OwnerPet[];
  addresses: OwnerAddress[];
  quote: QuoteBreakdown | null;
  quoting: boolean;
  submitting: boolean;
  submissionLocked: boolean;
  onPrepareQuote(draft: BookingDraft): Promise<void>;
  onSubmitOrder(notes: string): Promise<void>;
  onAbandonQuote(): void;
  onClose(): void;
};

const STEP_LABELS: Readonly<Record<BookingStep, string>> = {
  SERVICE: '服务', SCHEDULE: '时间', PET: '宠物', ADDRESS: '上门信息', QUOTE: '确认',
};
const STEP_TITLES: Readonly<Record<BookingStep, string>> = {
  SERVICE: '选择服务', SCHEDULE: '选择时间', PET: '宠物信息', ADDRESS: '上门信息', QUOTE: '确认预约',
};
const STEP_ORDER: readonly BookingStep[] = ['SERVICE', 'SCHEDULE', 'PET', 'ADDRESS', 'QUOTE'];
const DURATION_OPTIONS = [25, 30, 45, 60, 90, 120] as const;

const SERVICE_COPY: Readonly<Record<ServiceType, { label: string; price: string; copy: string }>> = {
  CAT_FEEDING: { label: '上门喂猫', price: '¥32 起', copy: '喂食换水、清洁宠物区域、提交服务记录' },
  DOG_WALKING: { label: '上门遛狗', price: '¥37 起', copy: '牵引散步、饮水照看、提交服务记录' },
};

function fen(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency', currency: 'CNY', minimumFractionDigits: 2,
  }).format(value / 100);
}

function OptionalDetails({ summary, children }: { summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div className="owner-optional-details">
    <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>{summary}</button>
    {open && <div>{children}</div>}
  </div>;
}

export function BookingFlow(props: BookingFlowProps) {
  const { draft, setDraft } = props;
  const currentIndex = STEP_ORDER.indexOf(draft.step);
  const compatiblePets = props.pets.filter((pet) => (
    draft.serviceType === 'CAT_FEEDING' ? pet.species === 'CAT' : pet.species === 'DOG'
  ));
  const locked = props.submissionLocked || props.quoting || props.submitting;

  const update = <Key extends keyof BookingDraft>(key: Key, value: BookingDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const goBack = () => {
    if (draft.step === 'SERVICE') return props.onClose();
    if (draft.step === 'QUOTE') props.onAbandonQuote();
    update('step', previousBookingStep(draft.step));
  };
  const goNext = () => update('step', nextBookingStep(draft));
  const prepareQuote = async () => {
    const normalized = props.addresses.length === 0
      ? { ...draft, addressMode: 'NEW' as const }
      : draft;
    if (!bookingStepIsComplete(normalized)) return;
    const ready = { ...normalized, step: 'QUOTE' as const };
    setDraft(ready);
    await props.onPrepareQuote(ready);
  };

  return <section className="owner-booking" aria-labelledby="owner-booking-title">
    <header className="owner-booking-head">
      <button type="button" className="owner-back-button" disabled={locked} onClick={goBack}>
        {draft.step === 'SERVICE' ? '关闭预约' : '返回上一步'}
      </button>
      <span>{currentIndex + 1} / {STEP_ORDER.length}</span>
    </header>
    <ol className="owner-booking-progress" aria-label="预约进度">
      {STEP_ORDER.map((step) => <li key={step} aria-current={step === draft.step ? 'step' : undefined}>
        {STEP_LABELS[step]}
      </li>)}
    </ol>
    <div className="owner-booking-title"><p>轻松预约</p><h1 id="owner-booking-title">{STEP_TITLES[draft.step]}</h1></div>

    {draft.step === 'SERVICE' && <div className="owner-booking-step">
      <fieldset className="owner-service-choice"><legend>需要什么服务</legend>
        {(Object.keys(SERVICE_COPY) as ServiceType[]).map((serviceType) => {
          const service = SERVICE_COPY[serviceType];
          return <label key={serviceType}>
            <input type="radio" name="booking-service" checked={draft.serviceType === serviceType} onChange={() => {
              setDraft((current) => selectBookingService(current, serviceType));
            }}/>
            <span><strong>{service.label}</strong><small>{service.copy}</small></span><b>{service.price}</b>
          </label>;
        })}
      </fieldset>
      <button type="button" className="owner-primary" onClick={goNext}>下一步：选择时间</button>
    </div>}

    {draft.step === 'SCHEDULE' && <div className="owner-booking-step">
      <label>服务时间<input type="datetime-local" value={draft.startsAt} onChange={(event) => update('startsAt', event.target.value)} required/></label>
      <label>服务时长<select value={draft.durationMinutes} onChange={(event) => update('durationMinutes', Number(event.target.value))}>
        {DURATION_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} 分钟</option>)}
      </select></label>
      <button type="button" className="owner-primary" disabled={!bookingStepIsComplete(draft)} onClick={goNext}>下一步：宠物信息</button>
    </div>}

    {draft.step === 'PET' && <div className="owner-booking-step">
      {compatiblePets.length > 0 && <>
        <label>选择已有宠物<select value={draft.petMode === 'EXISTING' ? draft.petId : ''} onChange={(event) => setDraft((current) => ({
          ...current, petMode: 'EXISTING', petId: event.target.value, petName: '', petNotes: '',
        }))}>
          <option value="">请选择</option>
          {compatiblePets.map((pet) => <option key={pet.id} value={pet.id}>{pet.name}</option>)}
        </select></label>
        <div className="owner-or"><span>或</span></div>
      </>}
      <button type="button" className="owner-add-button" onClick={() => setDraft((current) => ({
        ...current, petMode: 'NEW', petId: '', petName: '', petNotes: '',
      }))}>添加新宠物</button>
      {(draft.petMode === 'NEW' || compatiblePets.length === 0) && <div className="owner-new-resource">
        <label>宠物昵称<input value={draft.petName} maxLength={50} onChange={(event) => update('petName', event.target.value)}/></label>
        <p className="owner-fixed-value">宠物类型：{draft.petSpecies === 'CAT' ? '猫' : '狗'}</p>
        <OptionalDetails summary="补充照护要求（选填）">
          <label>照护备注（可选）<textarea value={draft.petNotes} maxLength={1000} onChange={(event) => update('petNotes', event.target.value)}/></label>
        </OptionalDetails>
      </div>}
      <button type="button" className="owner-primary" disabled={!bookingStepIsComplete({
        ...draft, petMode: compatiblePets.length === 0 ? 'NEW' : draft.petMode,
      })} onClick={() => setDraft((current) => {
        const normalized = compatiblePets.length === 0
          ? { ...current, petMode: 'NEW' as const }
          : current;
        return { ...normalized, step: nextBookingStep({ ...normalized, step: 'PET' }) };
      })}>下一步：上门信息</button>
    </div>}

    {draft.step === 'ADDRESS' && <div className="owner-booking-step">
      {props.addresses.length > 0 && <>
        <label>选择已有地址<select value={draft.addressMode === 'EXISTING' ? draft.addressId : ''} onChange={(event) => setDraft((current) => ({
          ...current, addressMode: 'EXISTING', addressId: event.target.value, addressDetail: '',
        }))}>
          <option value="">请选择</option>
          {props.addresses.map((address) => <option key={address.id} value={address.id}>{address.city} · {address.district}</option>)}
        </select></label>
        <div className="owner-or"><span>或</span></div>
      </>}
      <button type="button" className="owner-add-button" onClick={() => setDraft((current) => ({
        ...current, addressMode: 'NEW', addressId: '', addressDetail: '',
      }))}>添加新地址</button>
      {(draft.addressMode === 'NEW' || props.addresses.length === 0) && <div className="owner-new-resource">
        <p className="owner-fixed-value">城市：南京市</p>
        <label>服务区<select value={draft.districtName} onChange={(event) => update('districtName', event.target.value)}>
          {PILOT_DISTRICTS.map(({ district }) => <option key={district}>{district}</option>)}
        </select></label>
        <label>详细服务地址<input value={draft.addressDetail} maxLength={300} autoComplete="street-address" onChange={(event) => update('addressDetail', event.target.value)}/></label>
        <p className="pilot-privacy-hint">仅填写完成上门服务所需的地址信息。</p>
      </div>}
      <button type="button" className="owner-primary" disabled={locked || !bookingStepIsComplete({
        ...draft, addressMode: props.addresses.length === 0 ? 'NEW' : draft.addressMode,
      })} onClick={() => void prepareQuote()}>{props.quoting ? '正在获取报价…' : '获取服务报价'}</button>
    </div>}

    {draft.step === 'QUOTE' && <div className="owner-booking-step">
      {props.quote ? <div className="owner-quote-result">
        <div><span>服务器固定报价</span><strong>{fen(props.quote.totalFen)}</strong></div>
        <dl><div><dt>服务</dt><dd>{SERVICE_COPY[draft.serviceType].label}</dd></div><div><dt>时长</dt><dd>{draft.durationMinutes} 分钟</dd></div></dl>
        <p>创建订单后等待平台线下核对费用；本系统未处理在线支付。</p>
        <OptionalDetails summary="补充上门要求（选填）">
          <label>订单备注（可选）<textarea value={draft.orderNotes} disabled={props.submissionLocked} maxLength={500} onChange={(event) => update('orderNotes', event.target.value)}/></label>
        </OptionalDetails>
        <button type="button" className="owner-primary" disabled={props.submitting} onClick={() => void props.onSubmitOrder(draft.orderNotes)}>
          {props.submitting ? '正在提交…' : props.submissionLocked ? '重试提交同一订单' : '确认提交订单'}
        </button>
        {props.submissionLocked && !props.submitting && <button type="button" className="owner-add-button" onClick={props.onAbandonQuote}>放弃本次提交并重新报价</button>}
      </div> : <div className="owner-quote-loading" role="status">
        <p>{props.quoting ? '正在由服务器计算报价…' : '报价未能完成，请返回上一步重试。'}</p>
      </div>}
    </div>}
  </section>;
}
