import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createIdempotencyKey, type PilotApi } from './api.js';
import { PILOT_DISTRICTS, pilotDistrict } from './districts.js';
import type {
  CreateOwnerOrder,
  OrderStatus,
  OwnerAddress,
  OwnerOrder,
  OwnerPet,
  QuoteBreakdown,
  QuoteRequest,
  ServiceType,
} from './models.js';

type OwnerPilotWorkspaceProps = {
  api: PilotApi;
  onError(caught: unknown): string | null;
};

type OrderAttempt = { input: CreateOwnerOrder; key: string };

const SERVICE_LABELS: Readonly<Record<ServiceType, string>> = {
  CAT_FEEDING: '上门喂猫',
  DOG_WALKING: '上门遛狗',
};

const STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: '等待平台核对费用',
  PENDING_DISPATCH: '等待平台匹配服务人员',
  PENDING_SERVICE: '已匹配，等待上门服务',
  IN_SERVICE: '服务进行中',
  PENDING_CONFIRMATION: '服务报告待确认',
  COMPLETED: '服务已完成',
  CANCELLED: '订单已取消',
  REFUND_PENDING: '退款处理中',
  REFUNDED: '已退款',
  DISPUTED: '争议处理中',
  DISPATCH_FAILED: '匹配未成功',
  EXPIRED: '订单已过期',
};

const SPECIES_LABELS = { CAT: '猫', DOG: '狗' } as const;
const DURATION_OPTIONS = [25, 30, 45, 60, 90, 120] as const;

function fen(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency', currency: 'CNY', minimumFractionDigits: 2,
  }).format(value / 100);
}

function localDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

const NORMAL_ORDER_STAGE: Partial<Readonly<Record<OrderStatus, number>>> = {
  PENDING_PAYMENT: 1,
  PENDING_DISPATCH: 2,
  PENDING_SERVICE: 3,
  IN_SERVICE: 3,
  PENDING_CONFIRMATION: 4,
  COMPLETED: 6,
};

const EXCEPTIONAL_STATUS_COPY: Readonly<Partial<Record<OrderStatus, string>>> = {
  CANCELLED: '订单已取消，后续进度不再继续。',
  REFUND_PENDING: '退款正在处理，正常服务进度已停止。',
  REFUNDED: '退款已完成，正常服务进度已结束。',
  DISPUTED: '订单正在处理争议，正常服务进度已暂停。',
  DISPATCH_FAILED: '本次匹配未成功，请等待平台后续处理。',
  EXPIRED: '订单已过期，后续进度不再继续。',
};

function OrderTimeline({ order }: { order: OwnerOrder }) {
  const current = NORMAL_ORDER_STAGE[order.status];
  if (current === undefined) {
    const copy = EXCEPTIONAL_STATUS_COPY[order.status] ?? `${STATUS_LABELS[order.status]}，正常服务进度未继续。`;
    return <p className="pilot-order-exception">{copy}</p>;
  }
  const stages = [
    '需求已提交',
    order.status === 'PENDING_PAYMENT' ? '等待平台核对费用' : '费用已线下核对',
    '平台匹配服务人员',
    '上门服务',
    '查看服务报告',
    '宠主确认完成',
  ];
  return <ol className="pilot-order-timeline" aria-label="订单进度">
    {stages.map((label, index) => <li
      key={label}
      className={index < current ? 'is-done' : index === current ? 'is-current' : ''}
    >{label}</li>)}
  </ol>;
}

export function OwnerPilotWorkspace({ api, onError }: OwnerPilotWorkspaceProps) {
  const [pets, setPets] = useState<OwnerPet[]>([]);
  const [addresses, setAddresses] = useState<OwnerAddress[]>([]);
  const [orders, setOrders] = useState<OwnerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadVersion = useRef(0);
  const lifecycle = useRef({ mounted: false, generation: 0 });

  const [petName, setPetName] = useState('');
  const [petSpecies, setPetSpecies] = useState<OwnerPet['species']>('CAT');
  const [petNotes, setPetNotes] = useState('');
  const [savingPet, setSavingPet] = useState(false);
  const petLock = useRef(false);

  const [districtName, setDistrictName] = useState<string>(PILOT_DISTRICTS[0].district);
  const [addressDetail, setAddressDetail] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);
  const addressLock = useRef(false);

  const [serviceType, setServiceType] = useState<ServiceType>('CAT_FEEDING');
  const [petId, setPetId] = useState('');
  const [addressId, setAddressId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [orderNotes, setOrderNotes] = useState('');
  const [quote, setQuote] = useState<QuoteBreakdown | null>(null);
  const [quotedRequest, setQuotedRequest] = useState<QuoteRequest | null>(null);
  const [orderKey, setOrderKey] = useState('');
  const [orderAttempt, setOrderAttempt] = useState<OrderAttempt | null>(null);
  const orderAttemptRef = useRef<OrderAttempt | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const quoteLock = useRef(false);
  const quoteVersion = useRef(0);
  const submitLock = useRef(false);
  const [confirmingId, setConfirmingId] = useState('');
  const confirmLocks = useRef(new Set<string>());

  const isCurrent = useCallback((generation: number) => (
    lifecycle.current.mounted && lifecycle.current.generation === generation
  ), []);

  const reportError = useCallback((caught: unknown, generation: number) => {
    if (!isCurrent(generation)) return;
    const message = onError(caught);
    if (message !== null && isCurrent(generation)) setError(message);
  }, [isCurrent, onError]);

  const loadResources = useCallback(async (
    showLoading = true,
    generation = lifecycle.current.generation,
  ) => {
    if (!isCurrent(generation)) return;
    const version = ++loadVersion.current;
    if (showLoading) setLoading(true);
    setError('');
    try {
      const [nextPets, nextAddresses, nextOrders] = await Promise.all([
        api.listPets(), api.listAddresses(), api.listOrders(),
      ]);
      if (!isCurrent(generation) || version !== loadVersion.current) return;
      setPets(nextPets);
      setAddresses(nextAddresses);
      setOrders(nextOrders);
    } catch (caught) {
      if (isCurrent(generation) && version === loadVersion.current) {
        reportError(caught, generation);
      }
    } finally {
      if (isCurrent(generation) && version === loadVersion.current) setLoading(false);
    }
  }, [api, isCurrent, reportError]);

  useEffect(() => {
    lifecycle.current.mounted = true;
    const generation = ++lifecycle.current.generation;
    void loadResources(true, generation);
    return () => {
      lifecycle.current.mounted = false;
      lifecycle.current.generation += 1;
      loadVersion.current += 1;
      quoteVersion.current += 1;
    };
  }, [loadResources]);

  const compatiblePets = useMemo(() => pets.filter((pet) => (
    serviceType === 'CAT_FEEDING' ? pet.species === 'CAT' : pet.species === 'DOG'
  )), [pets, serviceType]);

  const invalidateQuote = () => {
    quoteVersion.current += 1;
    quoteLock.current = false;
    orderAttemptRef.current = null;
    setQuote(null);
    setQuotedRequest(null);
    setOrderKey('');
    setOrderAttempt(null);
    setQuoting(false);
    setError('');
  };

  const savePet = async (event: React.FormEvent) => {
    event.preventDefault();
    if (petLock.current) return;
    const generation = lifecycle.current.generation;
    if (!isCurrent(generation)) return;
    petLock.current = true;
    setSavingPet(true);
    setError('');
    try {
      await api.createPet({ name: petName, species: petSpecies, sensitiveNotes: petNotes });
      if (!isCurrent(generation)) return;
      setPetName('');
      setPetNotes('');
      await loadResources(false, generation);
    } catch (caught) {
      reportError(caught, generation);
    } finally {
      if (isCurrent(generation)) {
        petLock.current = false;
        setSavingPet(false);
      }
    }
  };

  const saveAddress = async (event: React.FormEvent) => {
    event.preventDefault();
    if (addressLock.current) return;
    const generation = lifecycle.current.generation;
    if (!isCurrent(generation)) return;
    const district = pilotDistrict(districtName);
    if (!district) return reportError(new Error('invalid district'), generation);
    addressLock.current = true;
    setSavingAddress(true);
    setError('');
    try {
      await api.createAddress({
        city: '南京市', district: district.district, serviceZone: district.zone,
        latitude: district.latitude, longitude: district.longitude,
        detail: addressDetail, accessInstructions: '',
      });
      if (!isCurrent(generation)) return;
      setAddressDetail('');
      await loadResources(false, generation);
    } catch (caught) {
      reportError(caught, generation);
    } finally {
      if (isCurrent(generation)) {
        addressLock.current = false;
        setSavingAddress(false);
      }
    }
  };

  const buildQuoteRequest = (): QuoteRequest | null => {
    if (!petId || !addressId || !startsAt) return null;
    const parsed = new Date(startsAt);
    if (!Number.isFinite(parsed.getTime())) return null;
    return {
      serviceType, petIds: [petId], addressId,
      startsAt: parsed.toISOString(), durationMinutes,
    };
  };

  const fetchQuote = async (event: React.FormEvent) => {
    event.preventDefault();
    if (quoteLock.current) return;
    const generation = lifecycle.current.generation;
    if (!isCurrent(generation)) return;
    const request = buildQuoteRequest();
    if (!request) return;
    const requestVersion = ++quoteVersion.current;
    quoteLock.current = true;
    setQuoting(true);
    setError('');
    setQuote(null);
    setQuotedRequest(null);
    setOrderKey('');
    try {
      const nextQuote = await api.getQuote(request);
      if (!isCurrent(generation) || requestVersion !== quoteVersion.current) return;
      setQuote(nextQuote);
      setQuotedRequest(request);
      setOrderKey(createIdempotencyKey());
    } catch (caught) {
      if (requestVersion === quoteVersion.current) reportError(caught, generation);
    } finally {
      if (isCurrent(generation) && requestVersion === quoteVersion.current) {
        quoteLock.current = false;
        setQuoting(false);
      }
    }
  };

  const submitOrder = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitLock.current || !quote || !quotedRequest || !orderKey) return;
    const generation = lifecycle.current.generation;
    if (!isCurrent(generation)) return;
    const quoteGeneration = quoteVersion.current;
    const attempt = orderAttemptRef.current ?? {
      input: { ...quotedRequest, petIds: [...quotedRequest.petIds], notes: orderNotes },
      key: orderKey,
    };
    if (orderAttemptRef.current === null) {
      orderAttemptRef.current = attempt;
      setOrderAttempt(attempt);
    }
    submitLock.current = true;
    setSubmitting(true);
    setError('');
    try {
      await api.createOrder(attempt.input, attempt.key);
      if (
        !isCurrent(generation)
        || quoteGeneration !== quoteVersion.current
        || orderAttemptRef.current !== attempt
      ) return;
      submitLock.current = false;
      setSubmitting(false);
      orderAttemptRef.current = null;
      setOrderAttempt(null);
      setQuote(null);
      setQuotedRequest(null);
      setOrderKey('');
      setOrderNotes('');
      await loadResources(false, generation);
    } catch (caught) {
      if (quoteGeneration === quoteVersion.current && orderAttemptRef.current === attempt) {
        reportError(caught, generation);
      }
    } finally {
      if (
        isCurrent(generation)
        && quoteGeneration === quoteVersion.current
        && orderAttemptRef.current === attempt
      ) {
        submitLock.current = false;
        setSubmitting(false);
      }
    }
  };

  const confirmOrder = async (orderId: string) => {
    if (confirmLocks.current.has(orderId)) return;
    const generation = lifecycle.current.generation;
    if (!isCurrent(generation)) return;
    confirmLocks.current.add(orderId);
    setConfirmingId(orderId);
    setError('');
    try {
      await api.confirmOrder(orderId);
      if (!isCurrent(generation)) return;
      await loadResources(false, generation);
    } catch (caught) {
      reportError(caught, generation);
    } finally {
      if (isCurrent(generation)) {
        confirmLocks.current.delete(orderId);
        setConfirmingId('');
      }
    }
  };

  return <section className="pilot-owner-workspace">
    <div className="pilot-owner-heading">
      <div><p className="pilot-kicker">宠主</p><h1>宠主工作区</h1></div>
      <button className="pilot-secondary" type="button" onClick={() => void loadResources()} disabled={loading}>
        刷新全部
      </button>
    </div>
    <p className="pilot-owner-intro">按步骤建立宠物与地址档案，获取服务器报价后提交需求。</p>
    {error && <p className="pilot-error" role="alert">{error}</p>}
    {loading ? <div className="pilot-owner-loading" aria-live="polite">正在读取宠主数据…</div> : <>
      <div className="pilot-owner-steps">
        <section className="pilot-owner-card" aria-labelledby="owner-pets-title">
          <div className="pilot-step-title"><span>1</span><div><h2 id="owner-pets-title">宠物档案</h2><p>仅保存服务所需信息</p></div></div>
          <form className="pilot-owner-form" onSubmit={(event) => void savePet(event)}>
            <label>宠物昵称<input value={petName} onChange={(event) => setPetName(event.target.value)} maxLength={50} required/></label>
            <label>宠物类型<select value={petSpecies} onChange={(event) => setPetSpecies(event.target.value as OwnerPet['species'])}>
              <option value="CAT">猫</option><option value="DOG">狗</option>
            </select></label>
            <label>照护备注（可选）<textarea value={petNotes} onChange={(event) => setPetNotes(event.target.value)} maxLength={1000}/></label>
            <button type="submit" disabled={savingPet}>{savingPet ? '正在保存…' : '保存宠物'}</button>
          </form>
          <div className="pilot-safe-list">
            {pets.length === 0 ? <p className="pilot-empty">还没有宠物档案。</p> : pets.map((pet) => (
              <div className="pilot-safe-item" key={pet.id}><strong>{pet.name} · {SPECIES_LABELS[pet.species]}</strong></div>
            ))}
          </div>
        </section>

        <section className="pilot-owner-card" aria-labelledby="owner-address-title">
          <div className="pilot-step-title"><span>2</span><div><h2 id="owner-address-title">服务地址</h2><p>详细地址加密后发送至服务器</p></div></div>
          <form className="pilot-owner-form" onSubmit={(event) => void saveAddress(event)}>
            <label>城市<input value="南京市" readOnly/></label>
            <label>服务区<select aria-label="服务区" value={districtName} onChange={(event) => setDistrictName(event.target.value)}>
              {PILOT_DISTRICTS.map(({ district }) => <option key={district}>{district}</option>)}
            </select></label>
            <label>详细服务地址<input value={addressDetail} onChange={(event) => setAddressDetail(event.target.value)} maxLength={300} autoComplete="street-address" required/></label>
            <p className="pilot-privacy-hint">仅填写完成上门服务所需的地址信息。</p>
            <button type="submit" disabled={savingAddress}>{savingAddress ? '正在保存…' : '保存地址'}</button>
          </form>
          <div className="pilot-safe-list">
            {addresses.length === 0 ? <p className="pilot-empty">还没有服务地址。</p> : addresses.map((address) => (
              <div className="pilot-safe-item" key={address.id}>
                <strong>{address.city} · {address.district}</strong><span>{address.serviceZone}服务圈</span>
              </div>
            ))}
          </div>
        </section>

        <section className="pilot-owner-card pilot-owner-order-card" aria-labelledby="owner-order-title">
          <div className="pilot-step-title"><span>3</span><div><h2 id="owner-order-title">报价与下单</h2><p>总价只由服务器计算</p></div></div>
          <form className="pilot-owner-form" onSubmit={(event) => void fetchQuote(event)}>
            <fieldset className="pilot-service-options"><legend>服务项目</legend>
              {(Object.keys(SERVICE_LABELS) as ServiceType[]).map((value) => <label key={value}>
                <input type="radio" name="serviceType" value={value} checked={serviceType === value} disabled={orderAttempt !== null} onChange={() => {
                  setServiceType(value); setPetId(''); invalidateQuote();
                }}/><span>{SERVICE_LABELS[value]}</span>
              </label>)}
            </fieldset>
            <div className="pilot-order-grid">
              <label>服务宠物<select value={petId} disabled={orderAttempt !== null} onChange={(event) => { setPetId(event.target.value); invalidateQuote(); }} required>
                <option value="">请选择</option>
                {compatiblePets.map((pet) => <option value={pet.id} key={pet.id}>{pet.name} · {SPECIES_LABELS[pet.species]}</option>)}
              </select></label>
              <label>服务地址<select value={addressId} disabled={orderAttempt !== null} onChange={(event) => { setAddressId(event.target.value); invalidateQuote(); }} required>
                <option value="">请选择</option>
                {addresses.map((address) => <option value={address.id} key={address.id}>{address.city} · {address.district}</option>)}
              </select></label>
              <label>服务时间<input type="datetime-local" value={startsAt} disabled={orderAttempt !== null} onChange={(event) => { setStartsAt(event.target.value); invalidateQuote(); }} required/></label>
              <label>服务时长<select value={durationMinutes} disabled={orderAttempt !== null} onChange={(event) => { setDurationMinutes(Number(event.target.value)); invalidateQuote(); }}>
                {DURATION_OPTIONS.map((minutes) => <option value={minutes} key={minutes}>{minutes} 分钟</option>)}
              </select></label>
            </div>
            <button type="submit" disabled={quoting || orderAttempt !== null || compatiblePets.length === 0 || addresses.length === 0}>
              {quoting ? '正在报价…' : '获取服务报价'}
            </button>
          </form>
          {quote && quotedRequest && <form className="pilot-quote-result" onSubmit={(event) => void submitOrder(event)}>
            <div><span>服务器固定报价</span><strong>{fen(quote.totalFen)}</strong></div>
            <p>创建订单后等待平台线下核对费用；本系统未处理在线支付。</p>
            <label>订单备注（可选）<textarea value={orderNotes} disabled={orderAttempt !== null} onChange={(event) => setOrderNotes(event.target.value)} maxLength={500}/></label>
            <button type="submit" disabled={submitting}>{submitting ? '正在提交…' : orderAttempt ? '重试提交同一订单' : '按固定报价提交订单'}</button>
            {orderAttempt && !submitting && <button type="button" className="pilot-secondary" onClick={invalidateQuote}>放弃本次提交并重新报价</button>}
          </form>}
        </section>
      </div>

      <section className="pilot-owner-orders" aria-labelledby="owner-orders-title">
        <div className="pilot-panel-heading"><div><p className="pilot-kicker">共享进度</p><h2 id="owner-orders-title">我的订单</h2></div></div>
        {orders.length === 0 ? <p className="pilot-empty">还没有订单。完成上方步骤即可提交服务需求。</p> : <div className="pilot-owner-order-list">
          {orders.map((order) => <article className="pilot-owner-order" key={order.id}>
            <div className="pilot-order-summary">
              <div><span className="pilot-status">{STATUS_LABELS[order.status]}</span><h3>{SERVICE_LABELS[order.serviceType]}</h3></div>
              <strong>{fen(order.totalFen)}</strong>
            </div>
            <dl className="pilot-order-facts">
              <div><dt>服务时间</dt><dd>{localDateTime(order.startsAt)} · {order.durationMinutes} 分钟</dd></div>
              <div><dt>安全地址</dt><dd>{order.city} · {order.district} · {order.serviceZone}服务圈</dd></div>
              {order.providerDisplayName && <div><dt>服务人员</dt><dd>{order.providerDisplayName}</dd></div>}
            </dl>
            {order.status === 'PENDING_PAYMENT' && <p className="pilot-offline-fee">本系统未处理在线支付</p>}
            <OrderTimeline order={order}/>
            {order.report && <section className="pilot-owner-report">
              <h4>服务报告</h4>
              <p>{order.report.notes || '服务人员未填写补充说明。'}</p>
              <ul>{Object.entries(order.report.checklist).map(([item, value]) => (
                <li key={item}>{value === true ? '已完成' : value === false ? '未完成' : String(value)} · {item}</li>
              ))}</ul>
              <span>提交于 {localDateTime(order.report.submittedAt)}</span>
            </section>}
            {order.status === 'PENDING_CONFIRMATION' && <button
              type="button" className="pilot-confirm-button"
              disabled={confirmingId === order.id}
              onClick={() => void confirmOrder(order.id)}
            >{confirmingId === order.id ? '正在确认…' : '确认服务完成'}</button>}
          </article>)}
        </div>}
      </section>
    </>}
  </section>;
}
