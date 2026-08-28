// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type PilotApi, PilotApiError } from './api.js';
import { OwnerPilotWorkspace } from './OwnerPilotWorkspace.js';

const pets = [
  { id: '11111111-1111-4111-8111-111111111111', name: '团子', species: 'CAT' as const, sensitiveNotes: '' },
  { id: '22222222-2222-4222-8222-222222222222', name: '豆包', species: 'DOG' as const, sensitiveNotes: '' },
];
const addresses = [{
  id: '33333333-3333-4333-8333-333333333333',
  city: '南京市' as const,
  district: '建邺区',
  serviceZone: '建邺区',
}];
const pendingOrder = {
  id: '44444444-4444-4444-8444-444444444444',
  serviceType: 'CAT_FEEDING' as const,
  status: 'PENDING_PAYMENT' as const,
  startsAt: '2026-09-10T02:00:00.000Z',
  durationMinutes: 30,
  totalFen: 3900,
  currency: 'CNY' as const,
  city: '南京市',
  district: '建邺区',
  serviceZone: '建邺区',
  notes: '请轻声进门',
};

function fakeApi(overrides: Partial<PilotApi> = {}): PilotApi {
  return {
    getSession: vi.fn(), createSession: vi.fn(), updateProfile: vi.fn(), deleteSession: vi.fn(),
    createInvite: vi.fn(), listInvites: vi.fn(),
    listPets: vi.fn().mockResolvedValue(pets),
    createPet: vi.fn().mockResolvedValue(pets[0]),
    listAddresses: vi.fn().mockResolvedValue(addresses),
    createAddress: vi.fn().mockResolvedValue(addresses[0]),
    getQuote: vi.fn().mockResolvedValue({
      baseFen: 3200, extraPetFen: 0, durationFen: 700,
      distanceFen: 0, holidayFen: 0, totalFen: 3900, currency: 'CNY',
    }),
    createOrder: vi.fn().mockResolvedValue({
      id: pendingOrder.id, status: 'PENDING_PAYMENT', totalFen: 3900, currency: 'CNY',
    }),
    listOrders: vi.fn().mockResolvedValue([pendingOrder]),
    confirmOrder: vi.fn().mockResolvedValue({ orderId: pendingOrder.id, status: 'COMPLETED', confirmedAt: '2026-09-10T03:05:00.000Z' }),
    getEvidenceReadUrl: vi.fn().mockResolvedValue({ url: '/api/v1/pilot/local-evidence?token=test', expiresInSeconds: 300 }),
    listProviderReviewQueue: vi.fn().mockResolvedValue([]),
    listAdminOrders: vi.fn().mockResolvedValue([]), listProviderOrders: vi.fn().mockResolvedValue([]),
    reviewProvider: vi.fn(), confirmManualFee: vi.fn(), startDispatch: vi.fn(),
    applyProvider: vi.fn(), setProviderAvailability: vi.fn(), acceptInvitation: vi.fn(),
    getAssignedAddress: vi.fn(), checkIn: vi.fn(), issueEvidenceUpload: vi.fn(),
    uploadEvidence: vi.fn(), attachEvidence: vi.fn(), submitReport: vi.fn(),
    ...overrides,
  } as PilotApi;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('OwnerPilotWorkspace', () => {
  afterEach(cleanup);

  it('offers exactly four supported districts and two service choices without access instructions', async () => {
    render(<OwnerPilotWorkspace api={fakeApi()} onError={() => 'error'}/>);

    expect(await screen.findByRole('heading', { name: '宠主工作区' })).toBeTruthy();
    const district = screen.getByRole('combobox', { name: '服务区' });
    expect(within(district).getAllByRole('option').map((option) => option.textContent)).toEqual([
      '建邺区', '鼓楼区', '玄武区', '秦淮区',
    ]);
    expect(screen.getAllByRole('radio').map((radio) => (radio as HTMLInputElement).value)).toEqual([
      'CAT_FEEDING', 'DOG_WALKING',
    ]);
    expect(document.body.textContent).not.toContain('访问说明');
    expect(screen.getByText('仅填写完成上门服务所需的地址信息。')).toBeTruthy();
  });

  it('creates and reloads owner pets and safe address summaries', async () => {
    const api = fakeApi({
      listPets: vi.fn().mockResolvedValue([pets[0]]).mockResolvedValueOnce([]),
      listAddresses: vi.fn().mockResolvedValue([addresses[0]])
        .mockResolvedValueOnce([]).mockResolvedValueOnce([]),
      listOrders: vi.fn().mockResolvedValue([]),
    });
    const user = userEvent.setup();
    render(<OwnerPilotWorkspace api={api} onError={() => 'error'}/>);

    expect(await screen.findByText('还没有宠物档案。')).toBeTruthy();
    await user.type(screen.getByLabelText('宠物昵称'), '团子');
    await user.selectOptions(screen.getByLabelText('宠物类型'), 'CAT');
    await user.type(screen.getByLabelText('照护备注（可选）'), '怕生');
    await user.click(screen.getByRole('button', { name: '保存宠物' }));

    expect(api.createPet).toHaveBeenCalledWith({ name: '团子', species: 'CAT', sensitiveNotes: '怕生' });
    await waitFor(() => expect(api.listPets).toHaveBeenCalledTimes(2));

    await user.selectOptions(screen.getByLabelText('服务区'), '秦淮区');
    await user.type(screen.getByLabelText('详细服务地址'), '中华路 88 号 2 幢 301');
    await user.click(screen.getByRole('button', { name: '保存地址' }));

    expect(api.createAddress).toHaveBeenCalledWith({
      city: '南京市', district: '秦淮区', serviceZone: '秦淮区',
      latitude: 32.039, longitude: 118.795,
      detail: '中华路 88 号 2 幢 301', accessInstructions: '',
    });
    await waitFor(() => expect(api.listAddresses).toHaveBeenCalledTimes(3));
    expect(screen.queryByDisplayValue('中华路 88 号 2 幢 301')).toBeNull();
    expect(document.body.textContent).not.toContain('中华路 88 号 2 幢 301');
  });

  it('freezes the complete order payload and idempotency key across a lost-response retry', async () => {
    const createOrder = vi.fn()
      .mockRejectedValueOnce(new Error('network detail'))
      .mockResolvedValueOnce({
        id: pendingOrder.id, status: 'PENDING_PAYMENT', totalFen: 3900, currency: 'CNY',
      });
    const api = fakeApi({ createOrder });
    const user = userEvent.setup();
    render(<OwnerPilotWorkspace api={api} onError={() => '服务暂时不可用，请稍后重试'}/>);

    await screen.findAllByText('团子 · 猫');
    await user.click(screen.getByRole('radio', { name: '上门喂猫' }));
    await user.selectOptions(screen.getByLabelText('服务宠物'), pets[0]!.id);
    await user.selectOptions(screen.getByRole('combobox', { name: '服务地址' }), addresses[0]!.id);
    fireEvent.change(screen.getByLabelText('服务时间'), { target: { value: '2026-09-10T10:00' } });
    await user.selectOptions(screen.getByLabelText('服务时长'), '30');
    await user.click(screen.getByRole('button', { name: '获取服务报价' }));

    const quoteRequest = {
      serviceType: 'CAT_FEEDING', petIds: [pets[0]!.id], addressId: addresses[0]!.id,
      startsAt: new Date('2026-09-10T10:00').toISOString(), durationMinutes: 30,
    };
    expect(api.getQuote).toHaveBeenCalledWith(quoteRequest);
    expect((await screen.findAllByText('¥39.00')).length).toBeGreaterThan(0);
    expect(screen.getByText('服务器固定报价')).toBeTruthy();
    await user.type(screen.getByLabelText('订单备注（可选）'), '请轻声进门');

    await user.click(screen.getByRole('button', { name: '按固定报价提交订单' }));
    expect((await screen.findByRole('alert')).textContent).toContain('服务暂时不可用，请稍后重试');
    const notes = screen.getByLabelText<HTMLTextAreaElement>('订单备注（可选）');
    expect(notes.disabled).toBe(true);
    fireEvent.change(notes, { target: { value: '篡改后的备注' } });
    await user.click(screen.getByRole('button', { name: '重试提交同一订单' }));

    expect(createOrder).toHaveBeenCalledTimes(2);
    const [firstInput, firstKey] = createOrder.mock.calls[0]!;
    const [secondInput, secondKey] = createOrder.mock.calls[1]!;
    expect(firstInput).toEqual({ ...quoteRequest, notes: '请轻声进门' });
    expect(firstInput).not.toHaveProperty('totalFen');
    expect(firstKey).toMatch(/^.{8,100}$/);
    expect(secondInput).toEqual(firstInput);
    expect(secondKey).toBe(firstKey);
    await waitFor(() => expect(api.listOrders).toHaveBeenCalledTimes(2));
  });

  it('ignores an old A quote after the inputs change A to B and back to A before it resolves', async () => {
    const pendingQuote = deferred<Awaited<ReturnType<PilotApi['getQuote']>>>();
    const getQuote = vi.fn().mockImplementation(() => pendingQuote.promise);
    const api = fakeApi({ getQuote });
    const user = userEvent.setup();
    render(<OwnerPilotWorkspace api={api} onError={() => 'error'}/>);

    await screen.findAllByText('团子 · 猫');
    await user.selectOptions(screen.getByLabelText('服务宠物'), pets[0]!.id);
    await user.selectOptions(screen.getByRole('combobox', { name: '服务地址' }), addresses[0]!.id);
    fireEvent.change(screen.getByLabelText('服务时间'), { target: { value: '2026-09-10T10:00' } });
    await user.click(screen.getByRole('button', { name: '获取服务报价' }));
    expect(getQuote).toHaveBeenCalledOnce();

    await user.selectOptions(screen.getByLabelText('服务时长'), '45');
    await user.selectOptions(screen.getByLabelText('服务时长'), '30');
    await act(async () => pendingQuote.resolve({
      baseFen: 3200, extraPetFen: 0, durationFen: 700,
      distanceFen: 0, holidayFen: 0, totalFen: 3900, currency: 'CNY',
    }));

    expect(screen.queryByText('服务器固定报价')).toBeNull();
    expect(screen.queryByRole('button', { name: '按固定报价提交订单' })).toBeNull();
    expect(api.createOrder).not.toHaveBeenCalled();
  });

  it('suppresses an old workspace 401 after unmount while preserving current 401 handling', async () => {
    const oldLoad = deferred<Awaited<ReturnType<PilotApi['listPets']>>>();
    const oldOnError = vi.fn().mockReturnValue(null);
    const oldView = render(<OwnerPilotWorkspace api={fakeApi({
      listPets: vi.fn().mockImplementation(() => oldLoad.promise),
    })} onError={oldOnError}/>);
    oldView.unmount();

    const laterView = render(<OwnerPilotWorkspace api={fakeApi()} onError={oldOnError}/>);
    await screen.findByRole('heading', { name: '宠主工作区' });
    await act(async () => oldLoad.reject(new PilotApiError(401, 'UNAUTHENTICATED')));
    expect(oldOnError).not.toHaveBeenCalled();
    laterView.unmount();

    const currentOnError = vi.fn().mockReturnValue(null);
    render(<OwnerPilotWorkspace api={fakeApi({
      listPets: vi.fn().mockRejectedValue(new PilotApiError(401, 'UNAUTHENTICATED')),
    })} onError={currentOnError}/>);
    await waitFor(() => expect(currentOnError).toHaveBeenCalledOnce());
  });

  it('suppresses stale quote, mutation, submit, and confirmation errors after unmount', async () => {
    const quote = deferred<Awaited<ReturnType<PilotApi['getQuote']>>>();
    const quoteOnError = vi.fn().mockReturnValue(null);
    const user = userEvent.setup();
    const quoteView = render(<OwnerPilotWorkspace api={fakeApi({
      getQuote: vi.fn().mockImplementation(() => quote.promise),
    })} onError={quoteOnError}/>);
    await screen.findAllByText('团子 · 猫');
    await user.selectOptions(screen.getByLabelText('服务宠物'), pets[0]!.id);
    await user.selectOptions(screen.getByRole('combobox', { name: '服务地址' }), addresses[0]!.id);
    fireEvent.change(screen.getByLabelText('服务时间'), { target: { value: '2026-09-10T10:00' } });
    await user.click(screen.getByRole('button', { name: '获取服务报价' }));
    quoteView.unmount();
    await act(async () => quote.reject(new PilotApiError(401, 'UNAUTHENTICATED')));
    expect(quoteOnError).not.toHaveBeenCalled();

    const mutation = deferred<Awaited<ReturnType<PilotApi['createPet']>>>();
    const mutationOnError = vi.fn().mockReturnValue(null);
    const mutationView = render(<OwnerPilotWorkspace api={fakeApi({
      createPet: vi.fn().mockImplementation(() => mutation.promise),
    })} onError={mutationOnError}/>);
    await screen.findAllByText('团子 · 猫');
    await user.type(screen.getByLabelText('宠物昵称'), '新宠物');
    await user.click(screen.getByRole('button', { name: '保存宠物' }));
    mutationView.unmount();
    await act(async () => mutation.reject(new PilotApiError(401, 'UNAUTHENTICATED')));
    expect(mutationOnError).not.toHaveBeenCalled();

    const submit = deferred<Awaited<ReturnType<PilotApi['createOrder']>>>();
    const submitOnError = vi.fn().mockReturnValue(null);
    const submitView = render(<OwnerPilotWorkspace api={fakeApi({
      createOrder: vi.fn().mockImplementation(() => submit.promise),
    })} onError={submitOnError}/>);
    await screen.findAllByText('团子 · 猫');
    await user.selectOptions(screen.getByLabelText('服务宠物'), pets[0]!.id);
    await user.selectOptions(screen.getByRole('combobox', { name: '服务地址' }), addresses[0]!.id);
    fireEvent.change(screen.getByLabelText('服务时间'), { target: { value: '2026-09-10T10:00' } });
    await user.click(screen.getByRole('button', { name: '获取服务报价' }));
    await user.click(screen.getByRole('button', { name: '按固定报价提交订单' }));
    submitView.unmount();
    await act(async () => submit.reject(new PilotApiError(401, 'UNAUTHENTICATED')));
    expect(submitOnError).not.toHaveBeenCalled();

    const confirm = deferred<Awaited<ReturnType<PilotApi['confirmOrder']>>>();
    const confirmOnError = vi.fn().mockReturnValue(null);
    const confirmView = render(<OwnerPilotWorkspace api={fakeApi({
      listOrders: vi.fn().mockResolvedValue([{ ...pendingOrder, status: 'PENDING_CONFIRMATION', evidence: [{ id: 'stale-evidence' }], report: { notes: '', submittedAt: '2026-09-10T03:00:00.000Z', checklist: {} } }]),
      confirmOrder: vi.fn().mockImplementation(() => confirm.promise),
    })} onError={confirmOnError}/>);
    await user.click(await screen.findByRole('button', { name: '查看履约证据 1' }));
    fireEvent.load(await screen.findByRole('img', { name: '订单履约证据 1' }));
    await user.click(screen.getByRole('button', { name: '确认服务完成' }));
    confirmView.unmount();
    await act(async () => confirm.reject(new PilotApiError(401, 'UNAUTHENTICATED')));
    expect(confirmOnError).not.toHaveBeenCalled();
  });

  it('shows offline-fee state and report timeline, then confirms the correct order and reloads', async () => {
    const reportOrder = {
      ...pendingOrder,
      id: '55555555-5555-4555-8555-555555555555',
      status: 'PENDING_CONFIRMATION' as const,
      providerDisplayName: '秦淮小周',
      report: {
        notes: '团子进食正常，已更换饮水。',
        submittedAt: '2026-09-10T03:00:00.000Z',
        checklist: { fed: true, freshWater: true },
      },
      evidence: [{ id: 'report-evidence' }],
    };
    const listOrders = vi.fn().mockResolvedValue([pendingOrder, reportOrder]);
    const api = fakeApi({ listOrders });
    const user = userEvent.setup();
    render(<OwnerPilotWorkspace api={api} onError={() => 'error'}/>);

    expect((await screen.findAllByText('等待平台核对费用')).length).toBeGreaterThan(0);
    expect(screen.getByText('本系统未处理在线支付')).toBeTruthy();
    expect(screen.getByText('团子进食正常，已更换饮水。')).toBeTruthy();
    expect(screen.getByText('已完成 · fed')).toBeTruthy();
    expect(screen.getByText('已完成 · freshWater')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '确认服务完成' })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: '查看履约证据 1' }));
    fireEvent.load(await screen.findByRole('img', { name: '订单履约证据 1' }));
    await user.click(screen.getByRole('button', { name: '确认服务完成' }));

    expect(api.confirmOrder).toHaveBeenCalledWith(reportOrder.id);
    await waitFor(() => expect(listOrders).toHaveBeenCalledTimes(2));
    expect(document.body.textContent).not.toMatch(/二维码|手机号|付款码|支付按钮/);
  });

  it('blocks duplicate order submits while the first request is in flight', async () => {
    let resolve!: (value: { id: string; status: 'PENDING_PAYMENT'; totalFen: number; currency: 'CNY' }) => void;
    const createOrder = vi.fn().mockImplementation(() => new Promise((done) => { resolve = done; }));
    const api = fakeApi({ createOrder });
    const user = userEvent.setup();
    render(<OwnerPilotWorkspace api={api} onError={() => 'error'}/>);
    await screen.findAllByText('团子 · 猫');
    await user.selectOptions(screen.getByLabelText('服务宠物'), pets[0]!.id);
    await user.selectOptions(screen.getByRole('combobox', { name: '服务地址' }), addresses[0]!.id);
    fireEvent.change(screen.getByLabelText('服务时间'), { target: { value: '2026-09-10T10:00' } });
    await user.click(screen.getByRole('button', { name: '获取服务报价' }));
    const form = screen.getByRole('button', { name: '按固定报价提交订单' }).closest('form')!;

    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });

    expect(createOrder).toHaveBeenCalledTimes(1);
    await act(async () => resolve({
      id: pendingOrder.id, status: 'PENDING_PAYMENT', totalFen: 3900, currency: 'CNY',
    }));
  });

  it('marks each normal timeline stage accurately and replaces exceptional timelines with explicit copy', async () => {
    const api = fakeApi({ listOrders: vi.fn().mockResolvedValue([
      pendingOrder,
      { ...pendingOrder, id: '55555555-5555-4555-8555-555555555555', status: 'PENDING_DISPATCH' },
      { ...pendingOrder, id: '66666666-6666-4666-8666-666666666666', status: 'CANCELLED' },
    ]) });
    render(<OwnerPilotWorkspace api={api} onError={() => 'error'}/>);

    const awaitingFee = (await screen.findAllByText('等待平台核对费用'))[0]!.closest('article')!;
    expect(awaitingFee.querySelector('.pilot-order-timeline .is-current')?.textContent).toBe('等待平台核对费用');
    expect(awaitingFee.querySelector('.pilot-order-timeline .is-done')?.textContent).toBe('需求已提交');

    const matching = screen.getByText('等待平台匹配服务人员').closest('article')!;
    expect(matching.querySelector('.pilot-order-timeline .is-current')?.textContent).toBe('平台匹配服务人员');

    const cancelled = screen.getByText('订单已取消').closest('article')!;
    expect(within(cancelled).queryByRole('list', { name: '订单进度' })).toBeNull();
    expect(within(cancelled).getByText('订单已取消，后续进度不再继续。')).toBeTruthy();
  });

  it('requires the owner to open mandatory evidence before confirming', async () => {
    const order = {
      ...pendingOrder,
      status: 'PENDING_CONFIRMATION' as const,
      report: { notes: '正常', submittedAt: '2026-09-10T03:00:00.000Z', checklist: { petCountConfirmed: true } },
      evidence: [{ id: 'evidence-owner-1' }],
    };
    const api = fakeApi({
      listOrders: vi.fn().mockResolvedValue([order]),
      getEvidenceReadUrl: vi.fn().mockResolvedValue({ url: '/api/v1/pilot/local-evidence?token=signed', expiresInSeconds: 300 }),
    });
    render(<OwnerPilotWorkspace api={api} onError={() => '读取失败'}/>);
    const confirm = await screen.findByRole('button', { name: '确认服务完成' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: '查看履约证据 1' }));
    expect(api.getEvidenceReadUrl).toHaveBeenCalledWith('evidence-owner-1');
    const image = await screen.findByRole('img', { name: '订单履约证据 1' }) as HTMLImageElement;
    expect(image.src).toContain('/api/v1/pilot/local-evidence?token=signed');
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.load(image);
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps confirmation blocked when an evidence image fails to load', async () => {
    const order = {
      ...pendingOrder,
      status: 'PENDING_CONFIRMATION' as const,
      report: { notes: '正常', submittedAt: '2026-09-10T03:00:00.000Z', checklist: { petCountConfirmed: true } },
      evidence: [{ id: 'evidence-owner-failed' }],
    };
    const api = fakeApi({
      listOrders: vi.fn().mockResolvedValue([order]),
      getEvidenceReadUrl: vi.fn().mockResolvedValue({ url: '/api/v1/pilot/local-evidence?token=broken', expiresInSeconds: 300 }),
    });
    render(<OwnerPilotWorkspace api={api} onError={() => '读取失败'}/>);

    const confirm = await screen.findByRole('button', { name: '确认服务完成' });
    await userEvent.click(screen.getByRole('button', { name: '查看履约证据 1' }));
    fireEvent.error(await screen.findByRole('img', { name: '订单履约证据 1' }));

    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('证据图片加载失败');
  });
});
