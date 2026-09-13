import { parseServiceOrder, type ServiceOrder } from './fulfillment-models.js';

export type OwnerReport = { orderId: string; serviceName: string; status: string; reportReady: boolean;
  notes: string; submittedAt: string; checklist: Array<{ label: string; value: string }>;
  evidence: Array<{ id: string }> };

const catLabels = [
  ['petCountConfirmed', '确认宠物数量'], ['foodRefilled', '补充食物'],
  ['waterRefilled', '更换饮水'], ['litterCleaned', '清理猫砂'],
] as const;
const dogLabels = [['leashSecured', '牵引装备已固定'], ['walkDurationMinutes', '实际遛狗时长']] as const;

function invalid(): never { throw new Error('INVALID_REPORT_RESPONSE'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

export function parseOwnerReport(value: unknown, expectedOrderId: string): OwnerReport {
  let order: ServiceOrder;
  try { order = parseServiceOrder(value, expectedOrderId); } catch { return invalid(); }
  const source = object(value);
  if (order.evidence.length > 12 || new Set(order.evidence.map((item) => item.id)).size !== order.evidence.length) invalid();
  const base = { orderId: order.id, serviceName: order.serviceType === 'CAT_FEEDING' ? '上门喂猫' : '上门遛狗',
    status: order.status };
  if (source.report === undefined) return { ...base, reportReady: false, notes: '', submittedAt: '', checklist: [], evidence: [] };
  const report = object(source.report);
  if (typeof report.notes !== 'string' || report.notes.length > 1000
    || typeof report.submittedAt !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(report.submittedAt)
    || !Number.isFinite(Date.parse(report.submittedAt))) invalid();
  const checklist = object(report.checklist);
  const labels = order.serviceType === 'CAT_FEEDING' ? catLabels : dogLabels;
  if (Object.keys(checklist).length !== labels.length || Object.keys(checklist).some((key) => !labels.some(([expected]) => expected === key))) invalid();
  const rows = labels.map(([key, label]) => {
    const entry = checklist[key];
    if (key === 'walkDurationMinutes') {
      if (typeof entry !== 'number' || !Number.isFinite(entry) || entry <= 0 || entry > 1440) invalid();
      return { label, value: `${entry} 分钟` };
    }
    if (entry !== true) invalid();
    return { label, value: '已完成' };
  });
  return { ...base, reportReady: true, notes: report.notes, submittedAt: report.submittedAt,
    checklist: rows, evidence: order.evidence };
}
