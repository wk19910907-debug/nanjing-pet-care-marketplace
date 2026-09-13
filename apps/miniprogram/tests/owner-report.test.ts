import { afterEach, expect, it, vi } from 'vitest';
import { parseOwnerReport } from '../services/owner-report.js';
import { createApiClient } from '../services/api.js';

const cat = { id: 'order-1', serviceType: 'CAT_FEEDING', status: 'PENDING_CONFIRMATION', durationMinutes: 25,
  evidence: [{ id: 'evidence-1' }], report: { notes: '精神很好', submittedAt: '2026-09-13T10:00:00.000Z',
    checklist: { petCountConfirmed: true, foodRefilled: true, waterRefilled: true, litterCleaned: true } } };

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('parses only a submitted matching-order report and localized checklist', () => {
  expect(parseOwnerReport(cat, 'order-1')).toMatchObject({ serviceName: '上门喂猫', notes: '精神很好',
    checklist: [{ label: '确认宠物数量', value: '已完成' }, { label: '补充食物', value: '已完成' },
      { label: '更换饮水', value: '已完成' }, { label: '清理猫砂', value: '已完成' }], evidence: [{ id: 'evidence-1' }] });
  expect(parseOwnerReport({ ...cat, report: undefined, evidence: [] }, 'order-1').reportReady).toBe(false);
  expect(() => parseOwnerReport(cat, 'another-order')).toThrow('INVALID_REPORT_RESPONSE');
  expect(() => parseOwnerReport({ ...cat, report: { ...cat.report, checklist: { foodRefilled: true } } }, 'order-1')).toThrow('INVALID_REPORT_RESPONSE');
  expect(() => parseOwnerReport({ ...cat, evidence: [{ id: 'evidence-1', objectKey: 'private' }], report: { ...cat.report, submittedAt: 'not-a-date' } }, 'order-1')).toThrow('INVALID_REPORT_RESPONSE');
});

it('shows real dog-walk duration and never exposes raw evidence storage keys', () => {
  const dog = { ...cat, serviceType: 'DOG_WALKING', evidence: [{ id: 'walk-photo', objectKey: 'private/path' }],
    report: { ...cat.report, checklist: { leashSecured: true, walkDurationMinutes: 32 } } };
  expect(parseOwnerReport(dog, 'order-1')).toMatchObject({ serviceName: '上门遛狗',
    checklist: [{ label: '牵引装备已固定', value: '已完成' }, { label: '实际遛狗时长', value: '32 分钟' }],
    evidence: [{ id: 'walk-photo' }] });
  expect(JSON.stringify(parseOwnerReport(dog, 'order-1'))).not.toContain('private/path');
});

it('loads report and private evidence read capability with owner authorization', async () => {
  const transport = vi.fn().mockResolvedValueOnce({ statusCode: 200, data: cat })
    .mockResolvedValueOnce({ statusCode: 200, data: { url: '/api/v1/pilot/local-evidence?token=shortlived', expiresInSeconds: 120 } });
  const api = createApiClient({ baseUrl: 'http://127.0.0.1:51800', token: () => 'owner-token', transport });
  expect((await api.getOwnerReport('order-1')).reportReady).toBe(true);
  expect(await api.getEvidenceReadUrl('evidence-1')).toBe('http://127.0.0.1:51800/api/v1/pilot/local-evidence?token=shortlived');
  expect(transport.mock.calls.map(([request]) => request.url)).toEqual([
    'http://127.0.0.1:51800/api/v1/pilot/orders/order-1',
    'http://127.0.0.1:51800/api/v1/evidence/evidence-1/read-url',
  ]);
  expect(transport.mock.calls[1]![0].headers.Authorization).toBe('Bearer owner-token');
});

it.each(['http://evil.example/photo', '//evil.example/photo', 'https://user:pass@example.com/photo', '/%2f%2fevil.example/photo'])(
  'rejects unsafe private evidence URL %s', async (url) => {
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:51800', token: () => 'owner-token',
      transport: vi.fn().mockResolvedValue({ statusCode: 200, data: { url, expiresInSeconds: 120 } }) });
    await expect(api.getEvidenceReadUrl('evidence-1')).rejects.toThrow();
  },
);

async function setupPage(report: unknown = cat) {
  let page: any;
  const api = { getOwnerReport: vi.fn(async () => parseOwnerReport(report, 'order-1')),
    getEvidenceReadUrl: vi.fn(async () => 'https://private.example/photo'), openDispute: vi.fn(async () => ({})) };
  vi.stubGlobal('getApp', () => ({ globalData: { api } }));
  vi.stubGlobal('wx', { showToast: vi.fn() });
  vi.stubGlobal('Page', (definition: any) => { page = { ...definition, data: structuredClone(definition.data),
    setData: vi.fn(function (this: any, value: unknown) { Object.assign(this.data, value); }) }; });
  await import('../pages/owner/report/index.js');
  await page.onLoad({ id: 'order-1' });
  return { page, api };
}

it('shows submitted report, loads private photo only on tap, and retries failed image', async () => {
  const { page, api } = await setupPage();
  expect(page.data.report.reportReady).toBe(true);
  expect(page.data.photos[0].url).toBe('');
  await page.viewEvidence({ currentTarget: { dataset: { id: 'evidence-1' } } });
  expect(api.getEvidenceReadUrl).toHaveBeenCalledWith('evidence-1');
  expect(page.data.photos[0].url).toBe('https://private.example/photo');
  page.evidenceError({ currentTarget: { dataset: { id: 'evidence-1' } } });
  expect(page.data.photos[0].url).toBe('');
  await page.viewEvidence({ currentTarget: { dataset: { id: 'evidence-1' } } });
  expect(api.getEvidenceReadUrl).toHaveBeenCalledTimes(2);
});

it('does not submit empty or duplicate disputes and keeps form after failure', async () => {
  const { page, api } = await setupPage();
  await page.dispute(); expect(api.openDispute).not.toHaveBeenCalled();
  page.onReason({ detail: { value: '现场照片不清楚' } });
  let reject!: (error: Error) => void;
  api.openDispute.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const pending = page.dispute(); await page.dispute();
  expect(api.openDispute).toHaveBeenCalledOnce();
  reject(new Error('NETWORK')); await pending;
  expect(page.data.reason).toBe('现场照片不清楚');
  expect(page.data.disputeError).not.toBe('');
  await page.dispute(); expect(api.openDispute).toHaveBeenCalledTimes(2);
  expect(page.data.disputeSubmitted).toBe(true);
});

it('shows pending state and discards responses after leaving page', async () => {
  const { page, api } = await setupPage({ ...cat, report: undefined, evidence: [] });
  expect(page.data.report.reportReady).toBe(false);
  let finish!: (value: any) => void;
  api.getOwnerReport.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = page.reload(); page.onUnload(); page.setData.mockClear();
  finish(parseOwnerReport(cat, 'order-1')); await pending;
  expect(page.setData).not.toHaveBeenCalled();
});
