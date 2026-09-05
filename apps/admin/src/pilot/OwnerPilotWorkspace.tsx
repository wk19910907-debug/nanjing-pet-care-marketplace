import { useCallback, useEffect, useRef, useState } from 'react';
import { createIdempotencyKey, type PilotApi } from './api.js';
import { NANJING_DISTRICTS } from '@pet/contracts';
import { pilotDistrict } from './districts.js';
import type {
  CreateOwnerOrder,
  OrderStatus,
  OwnerAddress,
  OwnerOrder,
  OwnerPet,
  QuoteBreakdown,
  QuoteRequest,
  PublicOperationsCatalog,
  ServiceType,
} from './models.js';
import { BookingFlow } from './owner/BookingFlow.js';
import { createBookingDraft, type BookingDraft } from './owner/booking.js';
import { OwnerHome } from './owner/OwnerHome.js';

type OwnerPilotWorkspaceProps = {
  api: PilotApi;
  displayName?: string;
  onError(caught: unknown): string | null;
  startBooking?: boolean;
  onRecovery?(): void;
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

export function OwnerPilotWorkspace({ api, displayName = '宠主', onError, startBooking = false, onRecovery }: OwnerPilotWorkspaceProps) {
  const [pets, setPets] = useState<OwnerPet[]>([]);
  const [addresses, setAddresses] = useState<OwnerAddress[]>([]);
  const [orders, setOrders] = useState<OwnerOrder[]>([]);
  const [catalog, setCatalog] = useState<PublicOperationsCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadVersion = useRef(0);
  const lifecycle = useRef({ mounted: false, generation: 0 });

  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingDraft, setBookingDraft] = useState<BookingDraft>(() => createBookingDraft());
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
  const [evidenceUrls, setEvidenceUrls] = useState<Record<string, string>>({});
  const [evidenceLoaded, setEvidenceLoaded] = useState<Record<string, boolean>>({});
  const [evidenceLoading, setEvidenceLoading] = useState('');
  const [evidenceErrors, setEvidenceErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (startBooking && catalog) setBookingOpen(true);
  }, [catalog, startBooking]);

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
      const [nextPets, nextAddresses, nextOrders, nextCatalog] = await Promise.all([
        api.listPets(), api.listAddresses(), api.listOrders(), api.getCatalog(),
      ]);
      if (!isCurrent(generation) || version !== loadVersion.current) return;
      setPets(nextPets);
      setAddresses(nextAddresses);
      setOrders(nextOrders);
      setCatalog(nextCatalog);
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

  const openBooking = (serviceType: ServiceType) => {
    if (!catalog?.services[serviceType].enabled) return;
    invalidateQuote();
    const firstDistrictCode = catalog.openDistricts[0];
    const firstDistrictName = NANJING_DISTRICTS.find(({ code }) => code === firstDistrictCode)?.name;
    setBookingDraft({
      ...createBookingDraft(serviceType),
      ...(firstDistrictName ? { districtName: firstDistrictName } : {}),
    });
    setBookingOpen(true);
  };

  const closeBooking = () => {
    if (orderAttemptRef.current !== null) return;
    invalidateQuote();
    setBookingOpen(false);
  };

  const abandonQuote = () => {
    invalidateQuote();
    setBookingDraft((current) => ({ ...current, step: 'VISIT_INFO' }));
  };

  const prepareQuote = async (inputDraft: BookingDraft) => {
    if (quoteLock.current) return;
    const generation = lifecycle.current.generation;
    if (!isCurrent(generation)) return;
    const requestVersion = ++quoteVersion.current;
    quoteLock.current = true;
    setQuoting(true);
    setError('');
    setQuote(null);
    setQuotedRequest(null);
    setOrderKey('');
    try {
      let ready = { ...inputDraft };
      if (ready.petMode === 'NEW') {
        const createdPet = await api.createPet({
          name: ready.petName.trim(),
          species: ready.petSpecies,
          sensitiveNotes: ready.petNotes,
        });
        if (!isCurrent(generation) || requestVersion !== quoteVersion.current) return;
        ready = { ...ready, petMode: 'EXISTING', petId: createdPet.id };
        setPets((current) => current.some((pet) => pet.id === createdPet.id)
          ? current : [...current, createdPet]);
        setBookingDraft(ready);
      }
      if (ready.addressMode === 'NEW') {
        const district = pilotDistrict(ready.districtName);
        if (!district) throw new Error('invalid district');
        const createdAddress = await api.createAddress({
          city: '南京市', district: district.district, serviceZone: district.zone,
          latitude: district.latitude, longitude: district.longitude,
          detail: ready.addressDetail.trim(), accessInstructions: '',
        });
        if (!isCurrent(generation) || requestVersion !== quoteVersion.current) return;
        ready = { ...ready, addressMode: 'EXISTING', addressId: createdAddress.id };
        setAddresses((current) => current.some((address) => address.id === createdAddress.id)
          ? current : [...current, createdAddress]);
        setBookingDraft(ready);
      }
      const parsed = new Date(ready.startsAt);
      if (!ready.petId || !ready.addressId || !Number.isFinite(parsed.getTime())) {
        throw new Error('invalid booking draft');
      }
      const request: QuoteRequest = {
        serviceType: ready.serviceType,
        petIds: [ready.petId],
        addressId: ready.addressId,
        startsAt: parsed.toISOString(),
        durationMinutes: ready.durationMinutes,
      };
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

  const submitOrder = async (orderNotes: string) => {
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
      await loadResources(false, generation);
      if (!isCurrent(generation)) return;
      setBookingOpen(false);
      setBookingDraft(createBookingDraft());
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

  const viewEvidence = async (evidenceId: string) => {
    if (evidenceLoading) return;
    const generation = lifecycle.current.generation;
    setEvidenceLoading(evidenceId);
    setEvidenceLoaded((current) => ({ ...current, [evidenceId]: false }));
    setEvidenceUrls((current) => {
      const next = { ...current };
      delete next[evidenceId];
      return next;
    });
    setEvidenceErrors((current) => ({ ...current, [evidenceId]: '' }));
    try {
      const result = await api.getEvidenceReadUrl(evidenceId);
      if (!isCurrent(generation)) return;
      setEvidenceUrls((current) => ({ ...current, [evidenceId]: result.url }));
    } catch (caught) {
      if (!isCurrent(generation)) return;
      setEvidenceErrors((current) => ({ ...current, [evidenceId]: onError(caught) ?? '证据暂时无法读取' }));
    } finally {
      if (isCurrent(generation)) setEvidenceLoading('');
    }
  };

  return <section className="pilot-owner-workspace">
    {error && <p className="pilot-error" role="alert">{error}</p>}
    {!catalog ? <div className="pilot-owner-loading">服务配置暂不可用，请刷新后重试。</div> : bookingOpen ? <BookingFlow
      catalog={catalog}
      draft={bookingDraft}
      setDraft={setBookingDraft}
      pets={pets}
      addresses={addresses}
      quote={quote}
      quoting={quoting}
      submitting={submitting}
      submissionLocked={orderAttempt !== null}
      onPrepareQuote={prepareQuote}
      onSubmitOrder={submitOrder}
      onAbandonQuote={abandonQuote}
      onClose={closeBooking}
    /> : <>
      <OwnerHome
        catalog={catalog}
        displayName={displayName}
        orders={orders}
        loading={loading}
        onBook={openBooking}
        onRefresh={() => void loadResources()}
      />
      <section id="owner-orders" className="pilot-owner-orders" aria-labelledby="owner-orders-title">
        <div className="pilot-panel-heading"><div><p className="pilot-kicker">共享进度</p><h2 id="owner-orders-title">我的订单</h2></div></div>
        {orders.length === 0 ? <p className="pilot-empty">还没有订单。选择首页服务即可开始预约。</p> : <div className="pilot-owner-order-list">
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
              <div className="pilot-evidence-list" aria-label="履约证据">
                {(order.evidence ?? []).map((item, index) => <div key={item.id}>
                  <button type="button" disabled={evidenceLoading === item.id} onClick={() => void viewEvidence(item.id)}>
                    {evidenceLoading === item.id ? '正在读取证据…' : `查看履约证据 ${index + 1}`}
                  </button>
                  {evidenceErrors[item.id] && <p className="pilot-error" role="alert">{evidenceErrors[item.id]}</p>}
                  {evidenceUrls[item.id] && <img
                    src={evidenceUrls[item.id]}
                    alt={`订单履约证据 ${index + 1}`}
                    onLoad={() => {
                      setEvidenceLoaded((current) => ({ ...current, [item.id]: true }));
                      setEvidenceErrors((current) => ({ ...current, [item.id]: '' }));
                    }}
                    onError={() => {
                      setEvidenceLoaded((current) => ({ ...current, [item.id]: false }));
                      setEvidenceErrors((current) => ({ ...current, [item.id]: '证据图片加载失败，请重试。' }));
                    }}
                  />}
                </div>)}
                {(order.evidence ?? []).length === 0 && <p className="pilot-error">履约证据尚未就绪，暂不能确认。</p>}
                <p className="pilot-privacy-hint">证据链接短时有效，仅用于当前订单确认。</p>
              </div>
            </section>}
            {order.status === 'PENDING_CONFIRMATION' && <button
              type="button" className="pilot-confirm-button"
              disabled={confirmingId === order.id || !(order.evidence?.length) || order.evidence.some((item) => !evidenceLoaded[item.id])}
              onClick={() => void confirmOrder(order.id)}
            >{confirmingId === order.id ? '正在确认…' : '确认服务完成'}</button>}
          </article>)}
        </div>}
      </section>
      <section className="owner-recovery" aria-label="订单恢复">
        <div><strong>订单恢复</strong><p>如需在新设备查看订单，可重新生成恢复凭据。</p></div>
        {onRecovery && <button type="button" className="access-text-button" onClick={onRecovery}>生成新的恢复凭据</button>}
      </section>
      <nav className="owner-bottom-nav" aria-label="宠主导航">
        <a href="#owner-home" aria-current="page"><span aria-hidden="true">⌂</span>首页</a>
        <a href="#owner-orders"><span aria-hidden="true">▣</span>订单</a>
        <a href="#owner-account"><span aria-hidden="true">○</span>我的</a>
      </nav>
    </>}
  </section>;
}
