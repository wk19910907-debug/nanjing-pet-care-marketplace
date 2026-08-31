import type { ApiClient } from './api.js';
import type { SelectedEvidence } from './evidence.js';
import type { Media, ServiceOrder } from './fulfillment-models.js';
import { reportReadiness } from '../presenters/provider-presenter.js';

type ServiceApi = Pick<ApiClient, 'getServiceOrder' | 'checkIn' | 'issueUpload' | 'uploadEvidence' | 'attachEvidence' | 'submitReport'>;
type PendingAttachment = Media & { objectKey: string; capturedAt: string };
export type ProviderServiceState = {
  order: ServiceOrder | null; busy: boolean; loaded: boolean; error: string;
  beforeConfirmed: boolean; afterConfirmed: boolean; checklist: Record<string, unknown>;
  walkMinutes: string; notes: string; evidenceCount: number; retryAttachment: boolean;
  readiness: { ready: boolean; missing: string[] }; canCheckIn: boolean; canUpload: boolean; canSubmit: boolean;
};
export function createProviderService(deps: {
  api: ServiceApi; orderId: string; chooseEvidence(): Promise<SelectedEvidence | null>;
  onChange(state: ProviderServiceState): void;
}) {
  let active = true;
  let busy = false;
  let loaded = false;
  let error = '';
  let order: ServiceOrder | null = null;
  let beforeConfirmed = false;
  let afterConfirmed = false;
  let checklist: Record<string, unknown> = {};
  let walkMinutes = '';
  let notes = '';
  let pending: PendingAttachment | null = null;
  function getState() {
    const readiness = reportReadiness(order?.serviceType ?? 'CAT_FEEDING', checklist, order?.evidence.length ?? 0);
    if (order?.serviceType === 'DOG_WALKING'
      && (!Number.isSafeInteger(checklist.walkDurationMinutes) || Number(checklist.walkDurationMinutes) > 1440)) readiness.ready = false;
    const enabled = active && loaded && !busy;
    return { order, busy, loaded, error, beforeConfirmed, afterConfirmed, checklist, walkMinutes, notes,
      evidenceCount: order?.evidence.length ?? 0, retryAttachment: pending !== null, readiness,
      canCheckIn: enabled && order?.status === 'PENDING_SERVICE' && beforeConfirmed,
      canUpload: enabled && order?.status === 'IN_SERVICE',
      canSubmit: enabled && order?.status === 'IN_SERVICE' && readiness.ready && afterConfirmed && pending === null,
    };
  }
  function emit() { if (active) deps.onChange(getState()); }
  async function refresh() {
    loaded = false;
    const latest = await deps.api.getServiceOrder(deps.orderId);
    if (!active) return;
    order = latest; loaded = true;
  }
  async function run(action: () => Promise<void>, message: string, recover = true) {
    if (!active || busy) return;
    busy = true; error = ''; emit();
    try { await action(); }
    catch {
      error = message;
      if (recover) { try { await refresh(); } catch { loaded = false; } }
    } finally { busy = false; emit(); }
  }
  function update(action: () => void) { if (!active || busy) return; action(); emit(); }
  return {
    getState,
    load: () => run(refresh, '任务暂时无法读取，请确认已登录服务人员账号后重试。', false),
    setBeforeConfirmed: (value: boolean) => update(() => { beforeConfirmed = value; }),
    setAfterConfirmed: (value: boolean) => update(() => { afterConfirmed = value; }),
    setChecklist: (key: string, value: boolean) => update(() => {
      const allowed = order?.serviceType === 'CAT_FEEDING'
        ? ['petCountConfirmed', 'foodRefilled', 'waterRefilled', 'litterCleaned'] : ['leashSecured'];
      if (allowed.includes(key)) checklist = { ...checklist, [key]: value };
    }),
    setWalkMinutes: (value: string) => update(() => {
      walkMinutes = value; const minutes = Number(value);
      checklist = { ...checklist, walkDurationMinutes: Number.isSafeInteger(minutes) && minutes > 0 && minutes <= 1440 ? minutes : 0 };
    }),
    setNotes: (value: string) => update(() => { notes = value.slice(0, 1000); }),
    checkIn: async () => {
      if (!getState().canCheckIn) return;
      await run(async () => {
        await deps.api.checkIn(deps.orderId, { beforeState: { petStateConfirmed: true } });
        await refresh();
      }, '签到未确认，请刷新任务后重试。');
    },
    upload: async () => {
      if (!getState().canUpload) return;
      await run(async () => {
        if (!pending) {
          const selected = await deps.chooseEvidence();
          if (!selected || !active) return;
          const issued = await deps.api.issueUpload(deps.orderId, selected.media);
          if (!active) return;
          await deps.api.uploadEvidence(issued, selected.bytes, selected.media.mimeType);
          pending = { ...selected.media, objectKey: issued.objectKey, capturedAt: new Date().toISOString() };
        }
        if (!active) return;
        const receipt = await deps.api.attachEvidence(deps.orderId, pending);
        if (!receipt || typeof receipt !== 'object' || !('id' in receipt) || typeof receipt.id !== 'string' || !receipt.id) throw new Error('INVALID_EVIDENCE_RECEIPT');
        pending = null;
        await refresh();
      }, '照片尚未确认。请重试；已上传的照片会优先重试后台确认，不重复上传。');
    },
    submit: async () => {
      if (!getState().canSubmit) return;
      await run(async () => {
        await deps.api.submitReport(deps.orderId, { checklist: { ...checklist }, afterState: { petStateConfirmed: true }, notes });
        await refresh();
      }, '报告结果尚未确认，请刷新任务查看结果后重试。');
    },
    dispose: () => { active = false; pending = null; },
  };
}

export type ProviderService = ReturnType<typeof createProviderService>;
