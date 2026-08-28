// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QuoteBreakdown } from '../models.js';
import { createBookingDraft, type BookingDraft } from './booking.js';
import { BookingFlow } from './BookingFlow.js';

const pets = [
  { id: 'cat-id', name: '团子', species: 'CAT' as const, sensitiveNotes: '' },
  { id: 'dog-id', name: '豆包', species: 'DOG' as const, sensitiveNotes: '' },
];
const addresses = [{
  id: 'address-id', city: '南京市' as const, district: '建邺区', serviceZone: '建邺区',
}];
const quote: QuoteBreakdown = {
  baseFen: 3200, extraPetFen: 0, durationFen: 700,
  distanceFen: 0, holidayFen: 0, totalFen: 3900, currency: 'CNY',
};

function Harness(props: { initial?: BookingDraft; quote?: QuoteBreakdown | null; pets?: typeof pets; onPrepareQuote?: (draft: BookingDraft) => Promise<void> }) {
  const [draft, setDraft] = useState(props.initial ?? createBookingDraft());
  return <BookingFlow
    draft={draft}
    setDraft={setDraft}
    pets={props.pets ?? pets}
    addresses={addresses}
    quote={props.quote ?? null}
    quoting={false}
    submitting={false}
    submissionLocked={false}
    onPrepareQuote={props.onPrepareQuote ?? vi.fn()}
    onSubmitOrder={vi.fn()}
    onAbandonQuote={vi.fn()}
    onClose={vi.fn()}
  />;
}

describe('BookingFlow', () => {
  afterEach(cleanup);

  it('shows one decision at a time and advances through existing pet and address choices', async () => {
    const onPrepareQuote = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<Harness onPrepareQuote={onPrepareQuote}/>);

    expect(screen.getByRole('heading', { name: '选择服务' })).toBeTruthy();
    expect(screen.queryByLabelText('服务时间')).toBeNull();
    await user.click(screen.getByRole('button', { name: '下一步：选择时间' }));

    fireEvent.change(screen.getByLabelText('服务时间'), { target: { value: '2026-09-10T10:00' } });
    await user.click(screen.getByRole('button', { name: '下一步：宠物信息' }));
    expect(screen.queryByLabelText('详细服务地址')).toBeNull();

    await user.selectOptions(screen.getByLabelText('选择已有宠物'), 'cat-id');
    await user.click(screen.getByRole('button', { name: '下一步：上门信息' }));
    await user.selectOptions(screen.getByLabelText('选择已有地址'), 'address-id');
    await user.click(screen.getByRole('button', { name: '获取服务报价' }));

    expect(onPrepareQuote).toHaveBeenCalledWith(expect.objectContaining({
      step: 'QUOTE', serviceType: 'CAT_FEEDING', petId: 'cat-id', addressId: 'address-id',
    }));
  });

  it('uses new-resource fields only when the user asks to add them', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ...createBookingDraft(), step: 'PET' }}/>);

    expect(screen.queryByLabelText('宠物昵称')).toBeNull();
    await user.click(screen.getByRole('button', { name: '添加新宠物' }));
    expect(screen.getByLabelText('宠物昵称')).toBeTruthy();
    expect(screen.getByText('补充照护要求（选填）')).toBeTruthy();
  });

  it('advances with a new pet when there are no compatible saved pets', async () => {
    const user = userEvent.setup();
    render(<Harness pets={[]} initial={{ ...createBookingDraft(), step: 'PET' }}/>);

    await user.type(screen.getByLabelText('宠物昵称'), '团子');
    await user.click(screen.getByRole('button', { name: '下一步：上门信息' }));
    expect(screen.getByRole('heading', { name: '上门信息' })).toBeTruthy();
  });

  it('renders a server quote and keeps optional order notes collapsed', async () => {
    const user = userEvent.setup();
    render(<Harness quote={quote} initial={{
      ...createBookingDraft(), step: 'QUOTE', startsAt: '2026-09-10T10:00',
      petId: 'cat-id', addressId: 'address-id',
    }}/>);

    expect(screen.getByText('服务器固定报价')).toBeTruthy();
    expect(screen.getByText('¥39.00')).toBeTruthy();
    expect(screen.queryByLabelText('订单备注（可选）')).toBeNull();
    await user.click(screen.getByText('补充上门要求（选填）'));
    expect(screen.getByLabelText('订单备注（可选）')).toBeTruthy();
  });
});
