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
  id: '33333333-3333-4333-8333-333333333333', city: '南京市' as const,
  district: '建邺区', serviceZone: '建邺区',
}];
const pendingOrder = {
  id: '44444444-4444-4444-8444-444444444444', serviceType: 'CAT_FEEDING' as const,
  status: 'PENDING_PAYMENT' as const, startsAt: '2026-09-10T02:00:00.000Z',
  durationMinutes: 30, totalFen: 3900, currency: 'CNY' as const,
  city: '南京市', district: '建邺区', serviceZone: '建邺区', petNames: ['团子'],
  notes: '请轻声进门',
};
const catalog = {
  services: {
    CAT_FEEDING: { enabled: true, basePriceFen: 3_200 },
    DOG_WALKING: { enabled: true, basePriceFen: 3_700 },
  },
  openDistricts: ['JIANYE', 'GULOU', 'XUANWU', 'QINHUAI'] as Array<'JIANYE' | 'GULOU' | 'XUANWU' | 'QINHUAI'>,
  announcement: '',
};

function fakeApi(overrides: Partial<PilotApi> = {}): PilotApi {
  return {
    getSession: vi.fn(), createSession: vi.fn(), updateProfile: vi.fn(), deleteSession: vi.fn(),
    createInvite: vi.fn(), listInvites: vi.fn(),
    listPets: vi.fn().mockResolvedValue(pets), createPet: vi.fn().mockResolvedValue(pets[0]),
    listAddresses: vi.fn().mockResolvedValue(addresses), createAddress: vi.fn().mockResolvedValue(addresses[0]),
    getQuote: vi.fn().mockResolvedValue({
      baseFen: 3200, extraPetFen: 0, durationFen: 700,
      distanceFen: 0, holidayFen: 0, totalFen: 3900, currency: 'CNY',
    }),
    createOrder: vi.fn().mockResolvedValue({
      id: pendingOrder.id, status: 'PENDING_PAYMENT', totalFen: 3900, currency: 'CNY',
    }),
    listOrders: vi.fn().mockResolvedValue([pendingOrder]),
    confirmOrder: vi.fn().mockResolvedValue({
      orderId: pendingOrder.id, status: 'COMPLETED', confirmedAt: '2026-09-10T03:05:00.000Z',
    }),
    getEvidenceReadUrl: vi.fn().mockResolvedValue({
      url: '/api/v1/pilot/local-evidence?token=test', expiresInSeconds: 300,
    }),
    listProviderReviewQueue: vi.fn().mockResolvedValue([]),
    listAdminOrders: vi.fn().mockResolvedValue([]), listProviderOrders: vi.fn().mockResolvedValue([]),
    reviewProvider: vi.fn(), confirmManualFee: vi.fn(), startDispatch: vi.fn(),
    applyProvider: vi.fn(), setProviderAvailability: vi.fn(), acceptInvitation: vi.fn(),
    getAssignedAddress: vi.fn(), checkIn: vi.fn(), issueEvidenceUpload: vi.fn(),
    uploadEvidence: vi.fn(), attachEvidence: vi.fn(), submitReport: vi.fn(),
    getCatalog: vi.fn().mockResolvedValue(catalog),
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

async function reachQuote(user: ReturnType<typeof userEvent.setup>, service: '上门喂猫' | '上门遛狗' = '上门喂猫') {
  await user.click(await screen.findByRole('button', { name: `预约${service}` }));
  fireEvent.change(screen.getByLabelText('服务时间'), { target: { value: '2026-09-10T10:00' } });
  await user.click(screen.getByRole('button', { name: '下一步：填写上门信息' }));
  await user.selectOptions(screen.getByLabelText('选择已有宠物'), service === '上门喂猫' ? pets[0]!.id : pets[1]!.id);
  await user.selectOptions(screen.getByLabelText('选择已有地址'), addresses[0]!.id);
  await user.click(screen.getByRole('button', { name: '获取服务报价' }));
}

describe('OwnerPilotWorkspace', () => {
  afterEach(cleanup);

  it('starts as a service home with zero visible form fields and truthful navigation', async () => {
    render(<OwnerPilotWorkspace displayName="建邺宠主" api={fakeApi({ listOrders: vi.fn().mockResolvedValue([]) })} onError={() => 'error'}/>);

    expect(await screen.findByRole('heading', { name: '今天需要照顾谁？' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    const navigation = screen.getByRole('navigation', { name: '宠主导航' });
    expect(within(navigation).getByRole('link', { name: '首页' }).getAttribute('href')).toBe('#owner-home');
    expect(within(navigation).getByRole('link', { name: '订单' }).getAttribute('href')).toBe('#owner-orders');
    expect(within(navigation).getByRole('link', { name: '我的' }).getAttribute('href')).toBe('#owner-account');
    expect(document.body.textContent).not.toMatch(/搜索|商城|社区|消息中心/);
  });

  it('consumes a start-booking intent once so a later refresh cannot reopen a closed flow', async () => {
    const consumed = vi.fn();
    const user = userEvent.setup();
    render(<OwnerPilotWorkspace displayName="建邺宠主" startBooking onStartBookingConsumed={consumed}
      api={fakeApi({ listOrders: vi.fn().mockResolvedValue([]) })} onError={() => 'error'}
    />);

    expect(await screen.findByRole('heading', { name: '服务与时间' })).toBeTruthy();
    expect(consumed).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: '关闭预约' }));
    await user.click(screen.getByRole('button', { name: '刷新' }));
    expect(await screen.findByRole('heading', { name: '今天需要照顾谁？' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '服务与时间' })).toBeNull();
  });

  it('freezes the complete order payload and idempotency key across a lost-response retry', async () => {
    const createOrder = vi.fn()
      .mockRejectedValueOnce(new Error('network detail'))
      .mockResolvedValueOnce({ id: pendingOrder.id, status: 'PENDING_PAYMENT', totalFen: 3900, currency: 'CNY' });
    const api = fakeApi({ createOrder });
    const user = userEvent.setup();
    render(<OwnerPilotWorkspace displayName="建邺宠主" api={api} onError={() => '服务暂时不可用，请稍后重试'}/>);

    await reachQuote(user);
    expect(await screen.findByText('服务器固定报价')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '补充上门要求（选填）' }));
    await user.type(screen.getByLabelText('订单备注（可选）'), '请轻声进门');
    await user.click(screen.getByRole('button', { name: '确认提交订单' }));

    expect((await screen.findByRole('alert')).textContent).toContain('服务暂时不可用，请稍后重试');
    expect(screen.getByLabelText<HTMLTextAreaElement>('订单备注（可选）').disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: '重试提交同一订单' }));

    expect(createOrder).toHaveBeenCalledTimes(2);
    const [firstInput, firstKey] = createOrder.mock.calls[0]!;
    const [secondInput, secondKey] = createOrder.mock.calls[1]!;
    expect(firstInput).toEqual({
      serviceType: 'CAT_FEEDING', petIds: [pets[0]!.id], addressId: addresses[0]!.id,
      startsAt: new Date('2026-09-10T10:00').toISOString(), durationMinutes: 30,
      notes: '请轻声进门',
    });
    expect(firstInput).not.toHaveProperty('totalFen');
    expect(firstKey).toMatch(/^.{8,100}$/);
    expect(secondInput).toEqual(firstInput);
    expect(secondKey).toBe(firstKey);
  });

  it('creates a new pet and address once inside the flow before requesting a quote', async () => {
    const createPet = vi.fn().mockResolvedValue(pets[0]);
    const createAddress = vi.fn().mockResolvedValue(addresses[0]);
    const api = fakeApi({
      listPets: vi.fn().mockResolvedValue([]), listAddresses: vi.fn().mockResolvedValue([]),
      listOrders: vi.fn().mockResolvedValue([]), createPet, createAddress,
    });
    const user = userEvent.setup();
    render(<OwnerPilotWorkspace displayName="建邺宠主" api={api} onError={() => 'error'}/>);

    await user.click(await screen.findByRole('button', { name: '预约上门喂猫' }));
    fireEvent.change(screen.getByLabelText('服务时间'), { target: { value: '2026-09-10T10:00' } });
    await user.click(screen.getByRole('button', { name: '下一步：填写上门信息' }));
    await user.type(screen.getByLabelText('宠物昵称'), '团子');
    await user.click(screen.getByRole('button', { name: '补充照护要求（选填）' }));
    await user.type(screen.getByLabelText('照护备注（可选）'), '怕生');
    await user.selectOptions(screen.getByLabelText('服务区'), '秦淮区');
    await user.type(screen.getByLabelText('详细服务地址'), '中华路 88 号 2 幢 301');
    await user.click(screen.getByRole('button', { name: '获取服务报价' }));

    await screen.findByText('服务器固定报价');
    expect(createPet).toHaveBeenCalledOnce();
    expect(createPet).toHaveBeenCalledWith({ name: '团子', species: 'CAT', sensitiveNotes: '怕生' });
    expect(createAddress).toHaveBeenCalledOnce();
    expect(createAddress).toHaveBeenCalledWith(expect.objectContaining({
      city: '南京市', district: '秦淮区', serviceZone: '秦淮区',
      detail: '中华路 88 号 2 幢 301', accessInstructions: '',
    }));
    expect(api.getQuote).toHaveBeenCalledWith(expect.objectContaining({
      serviceType: 'CAT_FEEDING', petIds: [pets[0]!.id], addressId: addresses[0]!.id,
    }));
    expect(document.body.textContent).not.toContain('中华路 88 号 2 幢 301');
  });

  it('blocks duplicate submits while the first request is in flight', async () => {
    const submit = deferred<Awaited<ReturnType<PilotApi['createOrder']>>>();
    const createOrder = vi.fn().mockImplementation(() => submit.promise);
    const user = userEvent.setup();
    render(<OwnerPilotWorkspace displayName="建邺宠主" api={fakeApi({ createOrder })} onError={() => 'error'}/>);
    await reachQuote(user);
    const button = await screen.findByRole('button', { name: '确认提交订单' });

    fireEvent.click(button);
    fireEvent.click(button);
    expect(createOrder).toHaveBeenCalledTimes(1);
    await act(async () => submit.resolve({
      id: pendingOrder.id, status: 'PENDING_PAYMENT', totalFen: 3900, currency: 'CNY',
    }));
  });

  it('suppresses a stale quote error after unmount', async () => {
    const pendingQuote = deferred<Awaited<ReturnType<PilotApi['getQuote']>>>();
    const onError = vi.fn().mockReturnValue(null);
    const user = userEvent.setup();
    const view = render(<OwnerPilotWorkspace displayName="建邺宠主" api={fakeApi({
      getQuote: vi.fn().mockImplementation(() => pendingQuote.promise),
    })} onError={onError}/>);
    await reachQuote(user);
    view.unmount();

    await act(async () => pendingQuote.reject(new PilotApiError(401, 'UNAUTHENTICATED')));
    expect(onError).not.toHaveBeenCalled();
  });

  it('marks normal and exceptional order progress without exposing a false timeline', async () => {
    const api = fakeApi({ listOrders: vi.fn().mockResolvedValue([
      pendingOrder,
      { ...pendingOrder, id: '55555555-5555-4555-8555-555555555555', status: 'PENDING_DISPATCH' },
      { ...pendingOrder, id: '66666666-6666-4666-8666-666666666666', status: 'CANCELLED' },
    ]) });
    render(<OwnerPilotWorkspace displayName="建邺宠主" api={api} onError={() => 'error'}/>);

    const awaitingFee = (await screen.findAllByText('等待平台核对费用')).at(-1)!.closest('article')!;
    expect(awaitingFee.querySelector('.pilot-order-timeline .is-current')?.textContent).toBe('等待平台核对费用');
    const matching = screen.getAllByText('等待平台匹配服务人员').at(-1)!.closest('article')!;
    expect(matching.querySelector('.pilot-order-timeline .is-current')?.textContent).toBe('平台匹配服务人员');
    const cancelled = screen.getByText('订单已取消').closest('article')!;
    expect(within(cancelled).queryByRole('list', { name: '订单进度' })).toBeNull();
    expect(within(cancelled).getByText('订单已取消，后续进度不再继续。')).toBeTruthy();
  });

  it('requires every evidence image to load successfully before owner confirmation', async () => {
    const order = {
      ...pendingOrder,
      status: 'PENDING_CONFIRMATION' as const,
      report: {
        notes: '团子进食正常，已更换饮水。', submittedAt: '2026-09-10T03:00:00.000Z',
        checklist: { petCountConfirmed: true, foodRefilled: true, waterRefilled: true, litterCleaned: true },
      },
      evidence: [{ id: 'evidence-owner-1' }],
    };
    const api = fakeApi({ listOrders: vi.fn().mockResolvedValue([order]) });
    render(<OwnerPilotWorkspace displayName="建邺宠主" api={api} onError={() => '读取失败'}/>);

    const confirm = await screen.findByRole('button', { name: '确认服务完成' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: '查看履约证据 1' }));
    const image = await screen.findByRole('img', { name: '订单履约证据 1' });
    fireEvent.error(image);
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('证据图片加载失败');
    fireEvent.load(image);
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(confirm);
    expect(api.confirmOrder).toHaveBeenCalledWith(order.id);
    await waitFor(() => expect(api.listOrders).toHaveBeenCalledTimes(2));
  });

  it('requests recovery delivery only after the first order succeeds', async () => {
    const onFirstOrderCreated = vi.fn().mockResolvedValue(undefined);
    const listOrders = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([pendingOrder]);
    const api = fakeApi({ listOrders });
    const user = userEvent.setup();
    render(<OwnerPilotWorkspace
      displayName="建邺宠主"
      api={api}
      onError={() => 'error'}
      onFirstOrderCreated={onFirstOrderCreated}
    />);

    await reachQuote(user);
    expect(onFirstOrderCreated).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '确认提交订单' }));

    await waitFor(() => expect(onFirstOrderCreated).toHaveBeenCalledOnce());
    expect(api.createOrder).toHaveBeenCalledOnce();
  });

  it('does not request another recovery credential for later orders', async () => {
    const onFirstOrderCreated = vi.fn().mockResolvedValue(undefined);
    const api = fakeApi({ listOrders: vi.fn().mockResolvedValue([pendingOrder]) });
    const user = userEvent.setup();
    render(<OwnerPilotWorkspace
      displayName="建邺宠主"
      api={api}
      onError={() => 'error'}
      onFirstOrderCreated={onFirstOrderCreated}
    />);

    await reachQuote(user);
    await user.click(screen.getByRole('button', { name: '确认提交订单' }));
    await waitFor(() => expect(api.listOrders).toHaveBeenCalledTimes(2));
    expect(onFirstOrderCreated).not.toHaveBeenCalled();
  });

  it('opens a single authorized order conversation only after its explicit control is selected', async () => {
    const api = fakeApi({ listOrderMessages: vi.fn().mockResolvedValue({ items: [], nextCursor: undefined }) });
    const user = userEvent.setup();
    render(<OwnerPilotWorkspace displayName="建邺宠主" api={api} onError={() => 'error'}/>);
    await user.click(await screen.findByRole('button', { name: `订单沟通 ${pendingOrder.id}` }));
    expect(await screen.findByRole('heading', { name: '订单沟通' })).toBeTruthy();
    expect(api.listOrderMessages).toHaveBeenCalledWith(pendingOrder.id, undefined);
  });
});
