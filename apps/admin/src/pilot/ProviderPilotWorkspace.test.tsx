// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PilotApi } from './api.js';
import { ProviderPilotWorkspace } from './ProviderPilotWorkspace.js';

const invitation = {
  id: '11111111-1111-4111-8111-111111111111', serviceType: 'CAT_FEEDING' as const,
  startsAt: '2026-09-10T02:00:00.000Z', durationMinutes: 30,
  city: '南京市', district: '秦淮区', serviceZone: '秦淮区',
  invitation: { id: '22222222-2222-4222-8222-222222222222', status: 'PENDING' as const, expiresAt: '2026-09-10T01:55:00.000Z' },
};
const assignedCat = {
  id: '33333333-3333-4333-8333-333333333333', serviceType: 'CAT_FEEDING' as const,
  status: 'PENDING_SERVICE' as const, startsAt: '2026-09-10T02:00:00.000Z',
  durationMinutes: 30, totalFen: 3900, currency: 'CNY' as const,
  city: '南京市', district: '秦淮区', serviceZone: '秦淮区', ownerDisplayName: '秦淮团子家',
};
const inServiceDog = { ...assignedCat, id: '44444444-4444-4444-8444-444444444444', serviceType: 'DOG_WALKING' as const, status: 'IN_SERVICE' as const };
const inServiceCat = { ...assignedCat, status: 'IN_SERVICE' as const };

function fakeApi(overrides: Partial<PilotApi> = {}): PilotApi {
  return {
    listProviderOrders: vi.fn().mockResolvedValue([invitation, assignedCat, inServiceDog]),
    applyProvider: vi.fn().mockResolvedValue(undefined),
    setProviderAvailability: vi.fn().mockResolvedValue(undefined),
    acceptInvitation: vi.fn().mockResolvedValue(undefined),
    getAssignedAddress: vi.fn().mockResolvedValue({ city: '南京市', district: '秦淮区', serviceZone: '秦淮区', detail: '中华路 88 号 2 幢 301' }),
    checkIn: vi.fn().mockResolvedValue({ id: 'report-1', orderId: assignedCat.id, checkedInAt: '2026-09-10T01:50:00.000Z' }),
    issueEvidenceUpload: vi.fn().mockResolvedValue({ objectKey: `orders/${inServiceDog.id}/evidence`, uploadUrl: '/api/v1/pilot/local-evidence?token=signed-capability', expiresInSeconds: 600 }),
    uploadEvidence: vi.fn().mockResolvedValue(undefined),
    attachEvidence: vi.fn().mockResolvedValue({ id: 'evidence-1' }),
    submitReport: vi.fn().mockResolvedValue({ id: 'report-2', orderId: inServiceDog.id, submittedAt: '2026-09-10T03:00:00.000Z' }),
    ...overrides,
  } as PilotApi;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('ProviderPilotWorkspace', () => {
  afterEach(cleanup);

  it('derives identity from the server session and applies with a 5km district centroid', async () => {
    const api = fakeApi();
    const user = userEvent.setup();
    render(<ProviderPilotWorkspace api={api} displayName="秦淮小周" onError={() => 'error'}/>);
    expect(await screen.findByRole('heading', { name: '服务人员工作区' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: /身份/ })).toBeNull();
    expect(screen.getByText('当前身份：秦淮小周')).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: '上门喂猫' }));
    await user.selectOptions(screen.getByRole('combobox', { name: '申请服务区' }), '秦淮区');
    await user.clear(screen.getByLabelText('喂猫经验（月）'));
    await user.type(screen.getByLabelText('喂猫经验（月）'), '18');
    await user.click(screen.getByRole('button', { name: '提交服务申请' }));
    expect(api.applyProvider).toHaveBeenCalledWith({
      serviceTypes: ['CAT_FEEDING'], serviceZone: '秦淮区', latitude: 32.039,
      longitude: 118.795, radiusKm: 5, catExperienceMonths: 18, dogExperienceMonths: 0,
    });
  });

  it('fails closed when provider experience months bypass native input bounds', async () => {
    const api = fakeApi();
    const user = userEvent.setup();
    render(<ProviderPilotWorkspace api={api} displayName="秦淮小周" onError={() => 'error'}/>);
    await user.click(await screen.findByRole('checkbox', { name: '上门喂猫' }));
    fireEvent.change(screen.getByLabelText('喂猫经验（月）'), { target: { value: '1201' } });
    fireEvent.submit(screen.getByRole('button', { name: '提交服务申请' }).closest('form')!);
    expect(api.applyProvider).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('0 到 1200 的整数');
  });

  it('shows only returned invitations/tasks and reveals an address only after the assigned API succeeds', async () => {
    const addressRequest = deferred<Awaited<ReturnType<PilotApi['getAssignedAddress']>>>();
    const api = fakeApi({ getAssignedAddress: vi.fn().mockImplementation(() => addressRequest.promise) });
    const user = userEvent.setup();
    render(<ProviderPilotWorkspace api={api} displayName="秦淮小周" onError={() => 'error'}/>);
    await screen.findByText(`邀请 ${invitation.id}`);
    expect(document.body.textContent).not.toContain('中华路 88 号');
    expect(document.body.textContent).not.toContain('其他服务人员');
    await user.click(screen.getByRole('button', { name: `读取订单 ${assignedCat.id} 完整地址` }));
    expect(document.body.textContent).not.toContain('中华路 88 号');
    addressRequest.resolve({ city: '南京市', district: '秦淮区', serviceZone: '秦淮区', detail: '中华路 88 号 2 幢 301' });
    expect(await screen.findByText('中华路 88 号 2 幢 301')).toBeTruthy();
    expect(api.getAssignedAddress).toHaveBeenCalledWith(assignedCat.id);
    expect(screen.queryByRole('button', { name: /确认服务完成/ })).toBeNull();
  });

  it('accepts only its returned invitation and checks in without a client timestamp', async () => {
    const api = fakeApi();
    const user = userEvent.setup();
    render(<ProviderPilotWorkspace api={api} displayName="秦淮小周" onError={() => 'error'}/>);
    await user.click(await screen.findByRole('button', { name: `接受邀请 ${invitation.id}` }));
    expect(api.acceptInvitation).toHaveBeenCalledWith(invitation.invitation.id);
    const checkIn = screen.getByRole('button', { name: `订单 ${assignedCat.id} 签到` });
    expect((checkIn as HTMLButtonElement).disabled).toBe(true);
    await user.click(checkIn);
    expect(api.checkIn).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox', { name: '我已到达并确认宠物当前状态可开始服务' }));
    expect((checkIn as HTMLButtonElement).disabled).toBe(false);
    await user.click(checkIn);
    expect(api.checkIn).toHaveBeenCalledWith(assignedCat.id, { petStateConfirmed: true });
    expect(api.checkIn).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ checkedInAt: expect.anything() }));
  });

  it('uploads image evidence through the signed capability and requires dog duration before report', async () => {
    const issueEvidenceUpload = vi.fn().mockResolvedValue({ objectKey: `orders/${inServiceDog.id}/evidence`, uploadUrl: '/api/v1/pilot/local-evidence?token=signed-capability', expiresInSeconds: 600 });
    const submitReport = vi.fn().mockResolvedValue({ id: 'report-2', orderId: inServiceDog.id, submittedAt: '2026-09-10T03:00:00.000Z' });
    const api = fakeApi({ issueEvidenceUpload, submitReport });
    const user = userEvent.setup();
    render(<ProviderPilotWorkspace api={api} displayName="秦淮小周" onError={() => 'error'}/>);
    const card = (await screen.findByText(`任务 ${inServiceDog.id}`)).closest('article')!;
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'walk.png', { type: 'image/png' });
    await user.upload(within(card).getByLabelText('履约图片'), file);
    await user.click(within(card).getByRole('button', { name: '上传履约图片' }));
    await waitFor(() => expect(api.issueEvidenceUpload).toHaveBeenCalledWith(inServiceDog.id, expect.objectContaining({
      mimeType: 'image/png', sizeBytes: 4, sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })));
    const media = issueEvidenceUpload.mock.calls[0]![1];
    expect(api.uploadEvidence).toHaveBeenCalledWith('/api/v1/pilot/local-evidence?token=signed-capability', expect.any(Uint8Array), 'image/png');
    expect(api.attachEvidence).toHaveBeenCalledWith(inServiceDog.id, expect.objectContaining({ objectKey: `orders/${inServiceDog.id}/evidence`, ...media }));

    await user.click(within(card).getByRole('checkbox', { name: '牵引装备已固定' }));
    expect((within(card).getByRole('button', { name: '提交服务报告' }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(within(card).getByLabelText('遛狗时长（分钟）'), '35');
    await user.type(within(card).getByLabelText('服务报告备注'), '散步与饮水正常');
    const submit = within(card).getByRole('button', { name: '提交服务报告' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.click(submit);
    expect(api.submitReport).not.toHaveBeenCalled();
    await user.click(within(card).getByRole('checkbox', { name: '我已确认服务后的宠物状态并如实填写报告' }));
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await user.click(submit);
    expect(api.submitReport).toHaveBeenCalledWith(inServiceDog.id, {
      checklist: { leashSecured: true, walkDurationMinutes: 35 },
      afterState: { petStateConfirmed: true }, notes: '散步与饮水正常',
    });
    expect(submitReport.mock.calls[0]![1]).not.toHaveProperty('checkedOutAt');
  });

  it('rejects an unsupported local image before issuing an upload capability', async () => {
    const api = fakeApi();
    const user = userEvent.setup();
    render(<ProviderPilotWorkspace api={api} displayName="秦淮小周" onError={(caught) => (
      caught instanceof Error ? caught.message : 'error'
    )}/>);
    const card = (await screen.findByText(`任务 ${inServiceDog.id}`)).closest('article')!;
    fireEvent.change(within(card).getByLabelText('履约图片'), {
      target: { files: [new File([new Uint8Array([71, 73, 70])], 'walk.gif', { type: 'image/gif' })] },
    });
    await user.click(within(card).getByRole('button', { name: '上传履约图片' }));
    expect((await screen.findByRole('alert')).textContent).toContain('仅支持 JPG、PNG 或 WebP 图片');
    expect(api.issueEvidenceUpload).not.toHaveBeenCalled();
  });

  it('refetches after an ambiguous invitation acceptance and renders assigned server state', async () => {
    const accepted = { ...assignedCat, id: invitation.id };
    const listProviderOrders = vi.fn()
      .mockResolvedValueOnce([invitation])
      .mockResolvedValueOnce([accepted]);
    const api = fakeApi({
      listProviderOrders,
      acceptInvitation: vi.fn().mockRejectedValue(new Error('response lost')),
    });
    const user = userEvent.setup();
    render(<ProviderPilotWorkspace api={api} displayName="秦淮小周" onError={() => '结果待核对'}/>);
    await user.click(await screen.findByRole('button', { name: `接受邀请 ${invitation.id}` }));
    expect(await screen.findByText(`任务 ${invitation.id}`)).toBeTruthy();
    expect(listProviderOrders).toHaveBeenCalledTimes(2);
  });

  it('refetches after an ambiguous check-in and renders in-service server state', async () => {
    const listProviderOrders = vi.fn()
      .mockResolvedValueOnce([assignedCat])
      .mockResolvedValueOnce([inServiceCat]);
    const api = fakeApi({
      listProviderOrders,
      checkIn: vi.fn().mockRejectedValue(new Error('response lost')),
    });
    const user = userEvent.setup();
    render(<ProviderPilotWorkspace api={api} displayName="秦淮小周" onError={() => '结果待核对'}/>);
    await user.click(await screen.findByRole('checkbox', { name: '我已到达并确认宠物当前状态可开始服务' }));
    await user.click(screen.getByRole('button', { name: `订单 ${assignedCat.id} 签到` }));
    await waitFor(() => expect(screen.getByText('IN_SERVICE')).toBeTruthy());
    expect(listProviderOrders).toHaveBeenCalledTimes(2);
  });

  it('recovers attached evidence from the server after an ambiguous attach response', async () => {
    const recovered = { ...inServiceDog, evidence: [{ id: 'evidence-existing' }] };
    const listProviderOrders = vi.fn()
      .mockResolvedValueOnce([inServiceDog])
      .mockResolvedValueOnce([recovered]);
    const api = fakeApi({
      listProviderOrders,
      attachEvidence: vi.fn().mockRejectedValue(new Error('response lost')),
    });
    const user = userEvent.setup();
    render(<ProviderPilotWorkspace api={api} displayName="秦淮小周" onError={() => '结果待核对'}/>);
    const card = (await screen.findByText(`任务 ${inServiceDog.id}`)).closest('article')!;
    await user.upload(
      within(card).getByLabelText('履约图片'),
      new File([new Uint8Array([137, 80, 78, 71])], 'walk.png', { type: 'image/png' }),
    );
    await user.click(within(card).getByRole('button', { name: '上传履约图片' }));
    expect(await within(card).findByText('履约图片已附加。')).toBeTruthy();
    expect(listProviderOrders).toHaveBeenCalledTimes(2);
  });

  it('refetches after an ambiguous report and renders submitted server state', async () => {
    const withEvidence = { ...inServiceDog, evidence: [{ id: 'evidence-existing' }] };
    const submitted = {
      ...inServiceDog, status: 'PENDING_CONFIRMATION' as const,
      evidence: [{ id: 'evidence-existing' }],
      report: {
        notes: '', submittedAt: '2026-09-10T03:00:00.000Z',
        checklist: { leashSecured: true, walkDurationMinutes: 35 },
      },
    };
    const listProviderOrders = vi.fn()
      .mockResolvedValueOnce([withEvidence])
      .mockResolvedValueOnce([submitted]);
    const api = fakeApi({
      listProviderOrders,
      submitReport: vi.fn().mockRejectedValue(new Error('response lost')),
    });
    const user = userEvent.setup();
    render(<ProviderPilotWorkspace api={api} displayName="秦淮小周" onError={() => '结果待核对'}/>);
    const card = (await screen.findByText(`任务 ${inServiceDog.id}`)).closest('article')!;
    await user.click(within(card).getByRole('checkbox', { name: '牵引装备已固定' }));
    await user.type(within(card).getByLabelText('遛狗时长（分钟）'), '35');
    await user.click(within(card).getByRole('checkbox', { name: '我已确认服务后的宠物状态并如实填写报告' }));
    await user.click(within(card).getByRole('button', { name: '提交服务报告' }));
    expect(await within(card).findByText(/服务报告已于/)).toBeTruthy();
    expect(listProviderOrders).toHaveBeenCalledTimes(2);
  });
});
