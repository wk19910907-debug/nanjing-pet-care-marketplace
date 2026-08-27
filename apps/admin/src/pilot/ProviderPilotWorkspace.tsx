import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PilotApiError, type PilotApi } from './api.js';
import { CHECKLIST_DEFINITIONS, completedChecklist } from './checklists.js';
import { PILOT_DISTRICTS, pilotDistrict } from './districts.js';
import type {
  AssignedAddress,
  EvidenceMedia,
  PilotChecklist,
  ProviderAssignedOrder,
  ProviderOrder,
  ServiceType,
} from './models.js';

type Props = { api: PilotApi; displayName: string; onError(caught: unknown): string | null };
const SERVICE_LABELS: Record<ServiceType, string> = {
  CAT_FEEDING: '上门喂猫', DOG_WALKING: '上门遛狗',
};
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function isAssigned(order: ProviderOrder): order is ProviderAssignedOrder {
  return 'status' in order;
}

function localInputDate(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

async function mediaFor(file: File): Promise<{ bytes: Uint8Array; media: EvidenceMedia }> {
  if (!IMAGE_TYPES.has(file.type) || file.size <= 0) {
    throw new PilotApiError(400, 'MEDIA_TYPE_NOT_ALLOWED');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0')).join('');
  return { bytes, media: { mimeType: file.type, sizeBytes: file.size, sha256 } };
}

export function ProviderPilotWorkspace({ api, displayName, onError }: Props) {
  const [orders, setOrders] = useState<ProviderOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lifecycle = useRef({ mounted: false, generation: 0, load: 0 });
  const locks = useRef(new Set<string>());
  const [pending, setPending] = useState('');

  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [districtName, setDistrictName] = useState<string>(PILOT_DISTRICTS[0].district);
  const [catMonths, setCatMonths] = useState(0);
  const [dogMonths, setDogMonths] = useState(0);
  const [availabilityStart, setAvailabilityStart] = useState('');
  const [availabilityEnd, setAvailabilityEnd] = useState('');
  const [coverageOrderId, setCoverageOrderId] = useState('');

  const [addresses, setAddresses] = useState<Record<string, AssignedAddress>>({});
  const [files, setFiles] = useState<Record<string, File | undefined>>({});
  const [evidenceAttached, setEvidenceAttached] = useState<Record<string, boolean>>({});
  const [checklists, setChecklists] = useState<Record<string, PilotChecklist>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const reportError = useCallback((caught: unknown, generation: number) => {
    if (!lifecycle.current.mounted || lifecycle.current.generation !== generation) return;
    const message = onError(caught);
    if (message !== null) setError(message);
  }, [onError]);

  const load = useCallback(async (showLoading = true, generation = lifecycle.current.generation) => {
    if (!lifecycle.current.mounted || lifecycle.current.generation !== generation) return;
    const version = ++lifecycle.current.load;
    if (showLoading) setLoading(true);
    setError('');
    try {
      const next = await api.listProviderOrders();
      if (!lifecycle.current.mounted || lifecycle.current.generation !== generation || lifecycle.current.load !== version) return;
      setOrders(next);
      const ids = new Set(next.filter(isAssigned).filter((order) => ['PENDING_SERVICE', 'IN_SERVICE'].includes(order.status)).map((order) => order.id));
      setAddresses((current) => Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id))));
    } catch (caught) {
      if (lifecycle.current.load === version) reportError(caught, generation);
    } finally {
      if (lifecycle.current.mounted && lifecycle.current.generation === generation && lifecycle.current.load === version) setLoading(false);
    }
  }, [api, reportError]);

  useEffect(() => {
    lifecycle.current.mounted = true;
    const generation = ++lifecycle.current.generation;
    void load(true, generation);
    return () => {
      lifecycle.current.mounted = false;
      lifecycle.current.generation += 1;
      lifecycle.current.load += 1;
    };
  }, [load]);

  const mutate = async (key: string, operation: () => Promise<void>, success: string, reload = true) => {
    if (locks.current.has(key)) return;
    const generation = lifecycle.current.generation;
    if (!lifecycle.current.mounted) return;
    locks.current.add(key);
    setPending(key);
    setError('');
    setNotice('');
    try {
      await operation();
      if (!lifecycle.current.mounted || lifecycle.current.generation !== generation) return;
      setNotice(success);
      if (reload) await load(false, generation);
    } catch (caught) {
      reportError(caught, generation);
    } finally {
      if (lifecycle.current.mounted && lifecycle.current.generation === generation) {
        locks.current.delete(key);
        setPending('');
      }
    }
  };

  const toggleService = (serviceType: ServiceType) => setServiceTypes((current) => (
    current.includes(serviceType)
      ? current.filter((item) => item !== serviceType)
      : [...current, serviceType]
  ));

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    const district = pilotDistrict(districtName);
    if (!district || serviceTypes.length === 0) {
      setError('请至少选择一项服务。');
      return;
    }
    if (![catMonths, dogMonths].every((months) => Number.isInteger(months) && months >= 0 && months <= 1200)) {
      setError('服务经验月数必须是 0 到 1200 的整数。');
      return;
    }
    void mutate('application', () => api.applyProvider({
      serviceTypes, serviceZone: district.zone,
      latitude: district.latitude, longitude: district.longitude, radiusKm: 5,
      catExperienceMonths: catMonths, dogExperienceMonths: dogMonths,
    }), '服务申请已提交，等待平台审核。');
  };

  const availabilityOrders = useMemo(() => orders.filter((order) => (
    !isAssigned(order) || ['PENDING_DISPATCH', 'PENDING_SERVICE'].includes(order.status)
  )), [orders]);
  const saveAvailability = (event: React.FormEvent) => {
    event.preventDefault();
    const startsAt = new Date(availabilityStart);
    const endsAt = new Date(availabilityEnd);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
      setError('可服务结束时间必须晚于开始时间。');
      return;
    }
    const selected = availabilityOrders.find((order) => order.id === coverageOrderId);
    if (selected) {
      const serviceStarts = new Date(selected.startsAt);
      const serviceEnds = new Date(serviceStarts.getTime() + selected.durationMinutes * 60_000);
      if (startsAt > serviceStarts || endsAt < serviceEnds) {
        setError('可服务时段必须完整覆盖所选订单时间窗。');
        return;
      }
    }
    void mutate('availability', () => api.setProviderAvailability({
      startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
    }), '可服务时间已保存。');
  };

  const revealAddress = (orderId: string) => void mutate(`address:${orderId}`, async () => {
    const address = await api.getAssignedAddress(orderId);
    if (lifecycle.current.mounted) setAddresses((current) => ({ ...current, [orderId]: address }));
  }, '完整地址已按本次任务授权读取。', false);

  const upload = (orderId: string) => {
    const file = files[orderId];
    if (!file) return;
    void mutate(`upload:${orderId}`, async () => {
      const { bytes, media } = await mediaFor(file);
      const issued = await api.issueEvidenceUpload(orderId, media);
      await api.uploadEvidence(issued.uploadUrl, bytes, media.mimeType);
      await api.attachEvidence(orderId, {
        ...media, objectKey: issued.objectKey, capturedAt: new Date().toISOString(),
      });
      if (lifecycle.current.mounted) setEvidenceAttached((current) => ({ ...current, [orderId]: true }));
    }, '履约图片已上传并校验。', false);
  };

  const submit = (order: ProviderAssignedOrder) => {
    const checklist = completedChecklist(order.serviceType, checklists[order.id] ?? {});
    if (!checklist || !evidenceAttached[order.id]) return;
    void mutate(`report:${order.id}`, () => api.submitReport(order.id, {
      checklist, afterState: { petStateConfirmed: true }, notes: notes[order.id] ?? '',
    }).then(() => undefined), '服务报告已提交，等待宠主确认。');
  };

  return <section className="pilot-provider-workspace">
    <div className="pilot-workspace-heading">
      <div><p className="pilot-kicker">服务人员</p><h1>服务人员工作区</h1></div>
      <button type="button" className="pilot-secondary" disabled={loading} onClick={() => void load()}>{loading ? '正在刷新…' : '刷新我的任务'}</button>
    </div>
    <p className="pilot-provider-identity">当前身份：{displayName}</p>
    <p className="pilot-owner-intro">身份由服务器会话确定；本页只读取发给你或已经分配给你的任务。</p>
    {error && <p className="pilot-error" role="alert">{error}</p>}
    {notice && <p className="pilot-success" role="status">{notice}</p>}

    <div className="pilot-provider-setup">
      <section className="pilot-ops-section" aria-labelledby="provider-application-title">
        <h2 id="provider-application-title">服务申请</h2>
        <form className="pilot-owner-form" onSubmit={apply}>
          <fieldset className="pilot-service-options"><legend>服务能力</legend>
            {(Object.keys(SERVICE_LABELS) as ServiceType[]).map((serviceType) => <label key={serviceType}>
              <input type="checkbox" checked={serviceTypes.includes(serviceType)} onChange={() => toggleService(serviceType)}/><span>{SERVICE_LABELS[serviceType]}</span>
            </label>)}
          </fieldset>
          <label>申请服务区<select aria-label="申请服务区" value={districtName} onChange={(event) => setDistrictName(event.target.value)}>
            {PILOT_DISTRICTS.map(({ district }) => <option key={district}>{district}</option>)}
          </select></label>
          <div className="pilot-order-grid">
            <label>喂猫经验（月）<input type="number" min="0" max="1200" step="1" value={catMonths} onChange={(event) => setCatMonths(Number(event.target.value))}/></label>
            <label>遛狗经验（月）<input type="number" min="0" max="1200" step="1" value={dogMonths} onChange={(event) => setDogMonths(Number(event.target.value))}/></label>
          </div>
          <p className="pilot-hint">服务半径固定为所选区域中心 5 公里；线下核验材料不在网页收集。</p>
          <button type="submit" disabled={pending === 'application'}>{pending === 'application' ? '正在提交…' : '提交服务申请'}</button>
        </form>
      </section>

      <section className="pilot-ops-section" aria-labelledby="provider-availability-title">
        <h2 id="provider-availability-title">可服务时间</h2>
        <form className="pilot-owner-form" onSubmit={saveAvailability}>
          <label>关联任务（可选）<select value={coverageOrderId} onChange={(event) => {
            const id = event.target.value;
            setCoverageOrderId(id);
            const order = availabilityOrders.find((item) => item.id === id);
            if (order) {
              setAvailabilityStart(localInputDate(order.startsAt));
              setAvailabilityEnd(localInputDate(new Date(new Date(order.startsAt).getTime() + order.durationMinutes * 60_000).toISOString()));
            }
          }}><option value="">不关联任务</option>{availabilityOrders.map((order) => <option key={order.id} value={order.id}>{order.id} · {SERVICE_LABELS[order.serviceType]}</option>)}</select></label>
          <label>开始时间<input type="datetime-local" value={availabilityStart} onChange={(event) => setAvailabilityStart(event.target.value)} required/></label>
          <label>结束时间<input type="datetime-local" value={availabilityEnd} onChange={(event) => setAvailabilityEnd(event.target.value)} required/></label>
          <button type="submit" disabled={pending === 'availability'}>{pending === 'availability' ? '正在保存…' : '保存可服务时间'}</button>
        </form>
      </section>
    </div>

    <section className="pilot-provider-orders" aria-labelledby="provider-orders-title">
      <h2 id="provider-orders-title">我的邀请与任务</h2>
      {loading ? <div className="pilot-owner-loading" aria-live="polite">正在读取服务人员数据…</div>
        : orders.length === 0 ? <p className="pilot-empty">当前没有发给你的邀请或已分配任务。</p>
        : <div className="pilot-provider-order-list">{orders.map((order) => {
          if (!isAssigned(order)) return <article className="pilot-provider-order" key={order.id}>
            <span className="pilot-status">邀请 {order.invitation.status}</span>
            <h3>邀请 {order.id}</h3>
            <p>{SERVICE_LABELS[order.serviceType]} · {order.city} · {order.district} · {order.serviceZone}服务圈</p>
            <p>{new Date(order.startsAt).toLocaleString('zh-CN')} · {order.durationMinutes} 分钟</p>
            {order.invitation.status === 'PENDING' && <button type="button" disabled={pending === `accept:${order.id}`} onClick={() => void mutate(
              `accept:${order.id}`, () => api.acceptInvitation(order.invitation.id), '邀请已接受。',
            )}>接受邀请 {order.id}</button>}
          </article>;

          const currentChecklist = checklists[order.id] ?? {};
          const validChecklist = completedChecklist(order.serviceType, currentChecklist);
          const address = addresses[order.id];
          return <article className="pilot-provider-order" key={order.id}>
            <span className="pilot-status">{order.status}</span><h3>任务 {order.id}</h3>
            <p>{SERVICE_LABELS[order.serviceType]} · 宠主昵称 {order.ownerDisplayName ?? '未设置昵称'}</p>
            <p>{order.city} · {order.district} · {order.serviceZone}服务圈</p>
            {['PENDING_SERVICE', 'IN_SERVICE'].includes(order.status) && <>
              <button type="button" disabled={pending === `address:${order.id}`} onClick={() => revealAddress(order.id)}>读取订单 {order.id} 完整地址</button>
              {address && <div className="pilot-exact-address"><strong>本次任务完整地址</strong><p>{address.detail}</p></div>}
            </>}
            {order.status === 'PENDING_SERVICE' && <button type="button" disabled={pending === `checkin:${order.id}`} onClick={() => void mutate(
              `checkin:${order.id}`, () => api.checkIn(order.id, { petStateConfirmed: true }).then(() => undefined), '签到成功，时间由服务器记录。',
            )}>订单 {order.id} 签到</button>}
            {order.status === 'IN_SERVICE' && <div className="pilot-fulfillment-panel">
              <h4>履约图片与服务清单</h4>
              <label>履约图片<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFiles((current) => ({ ...current, [order.id]: event.target.files?.[0] }))}/></label>
              <button type="button" disabled={!files[order.id] || pending === `upload:${order.id}`} onClick={() => upload(order.id)}>{pending === `upload:${order.id}` ? '正在上传并校验…' : evidenceAttached[order.id] ? '重新上传履约图片' : '上传履约图片'}</button>
              {evidenceAttached[order.id] && <p className="pilot-success">履约图片已附加。</p>}
              {order.serviceType === 'CAT_FEEDING' ? <fieldset className="pilot-checklist"><legend>喂猫服务清单</legend>{CHECKLIST_DEFINITIONS.CAT_FEEDING.map((key) => <label key={key}>
                <input type="checkbox" checked={currentChecklist[key] === true} onChange={(event) => setChecklists((current) => ({ ...current, [order.id]: { ...currentChecklist, [key]: event.target.checked } }))}/><span>{{
                  petCountConfirmed: '宠物数量已确认', foodRefilled: '猫粮已补充', waterRefilled: '饮水已补充', litterCleaned: '猫砂已清理',
                }[key]}</span>
              </label>)}</fieldset> : <fieldset className="pilot-checklist"><legend>遛狗服务清单</legend>
                <label><input type="checkbox" checked={currentChecklist.leashSecured === true} onChange={(event) => setChecklists((current) => ({ ...current, [order.id]: { ...currentChecklist, leashSecured: event.target.checked } }))}/><span>牵引装备已固定</span></label>
                <label>遛狗时长（分钟）<input type="number" min="1" max="600" step="1" value={typeof currentChecklist.walkDurationMinutes === 'number' ? currentChecklist.walkDurationMinutes : ''} onChange={(event) => setChecklists((current) => ({ ...current, [order.id]: { ...currentChecklist, walkDurationMinutes: Number(event.target.value) } }))}/></label>
              </fieldset>}
              <label>服务报告备注<textarea maxLength={1000} value={notes[order.id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [order.id]: event.target.value }))}/></label>
              <button type="button" disabled={!evidenceAttached[order.id] || !validChecklist || pending === `report:${order.id}`} onClick={() => submit(order)}>{pending === `report:${order.id}` ? '正在提交报告…' : '提交服务报告'}</button>
            </div>}
            {order.report && <p className="pilot-success">服务报告已于 {new Date(order.report.submittedAt).toLocaleString('zh-CN')} 提交。</p>}
          </article>;
        })}</div>}
    </section>
  </section>;
}
