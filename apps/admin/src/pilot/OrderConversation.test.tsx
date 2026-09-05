// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PilotApi } from './api.js';
import { OrderConversation } from './OrderConversation.js';

const orderId = '11111111-1111-4111-8111-111111111111';
const message = { id: 'message-1', orderId, authorRole: 'OWNER' as const, body: '请轻声敲门', createdAt: '2026-09-01T00:00:00.000Z' };
function fakeApi(overrides: Partial<PilotApi> = {}): PilotApi {
  return { listOrderMessages: vi.fn().mockResolvedValue({ items: [message], nextCursor: 'older-1' }), sendOrderMessage: vi.fn().mockResolvedValue({ ...message, id: 'message-2', authorRole: 'ADMIN' as const, body: '好的' }), ...overrides } as PilotApi;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

describe('OrderConversation', () => {
  afterEach(cleanup);

  it('loads labelled messages, supports manual refresh and stable older-message pagination', async () => {
    const api = fakeApi({ listOrderMessages: vi.fn().mockResolvedValueOnce({ items: [message], nextCursor: 'older-1' }).mockResolvedValueOnce({ items: [message], nextCursor: 'older-1' }).mockResolvedValueOnce({ items: [{ ...message, id: 'old-1', body: '更早消息' }], nextCursor: undefined }) });
    const user = userEvent.setup();
    render(<OrderConversation api={api} orderId={orderId} role="ADMIN" onError={() => '失败'}/>);
    expect(await screen.findByText(/宠主 · 请轻声敲门/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '刷新沟通记录' }));
    await user.click(await screen.findByRole('button', { name: '加载更早消息' }));
    expect(api.listOrderMessages).toHaveBeenLastCalledWith(orderId, 'older-1');
    expect(screen.getByText(/宠主 · 更早消息/)).toBeTruthy();
  });

  it('keeps a failed draft, clears it only after send resolves, and locks duplicate sends', async () => {
    const pending = deferred<typeof message>();
    const sendOrderMessage = vi.fn().mockImplementation(() => pending.promise);
    const api = fakeApi({ sendOrderMessage });
    const user = userEvent.setup();
    render(<OrderConversation api={api} orderId={orderId} role="OWNER" onError={() => '发送失败'}/>);
    await screen.findByText(/宠主 · 请轻声敲门/);
    const draft = screen.getByLabelText<HTMLTextAreaElement>('订单沟通内容');
    await user.type(draft, '请带上水');
    const send = screen.getByRole('button', { name: '发送消息' });
    await user.click(send); await user.click(send);
    expect(sendOrderMessage).toHaveBeenCalledTimes(1);
    expect(draft.value).toBe('请带上水');
    await act(async () => pending.resolve({ ...message, id: 'message-3', body: '请带上水' }));
    expect(draft.value).toBe('');
  });

  it('locks the older-message control until its cursor request settles', async () => {
    const older = deferred<{ items: typeof message[] }>();
    const listOrderMessages = vi.fn().mockResolvedValueOnce({ items: [message], nextCursor: 'older-1' }).mockImplementationOnce(() => older.promise);
    const api = fakeApi({ listOrderMessages });
    const user = userEvent.setup();
    render(<OrderConversation api={api} orderId={orderId} role="OWNER" onError={() => '失败'}/>);
    const button = await screen.findByRole('button', { name: '加载更早消息' });
    await user.click(button); await user.click(button);
    expect(listOrderMessages).toHaveBeenCalledTimes(2);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => older.resolve({ items: [] }));
  });

  it('caps drafts at 500 code points and suppresses stale results after an order switch', async () => {
    const stale = deferred<{ items: typeof message[]; nextCursor?: string }>();
    const other = '22222222-2222-4222-8222-222222222222';
    const api = fakeApi({ listOrderMessages: vi.fn().mockImplementation((id: string) => id === orderId ? stale.promise : Promise.resolve({ items: [{ ...message, id: 'other-message', orderId: other, body: '另一订单' }], nextCursor: undefined })) });
    const view = render(<OrderConversation api={api} orderId={orderId} role="OWNER" onError={() => '失败'}/>);
    view.rerender(<OrderConversation api={api} orderId={other} role="OWNER" onError={() => '失败'}/>);
    expect(await screen.findByText(/宠主 · 另一订单/)).toBeTruthy();
    await act(async () => stale.resolve({ items: [message] }));
    expect(screen.queryByText(/宠主 · 请轻声敲门/)).toBeNull();
    const input = screen.getByLabelText<HTMLTextAreaElement>('订单沟通内容');
    fireEvent.change(input, { target: { value: '😀'.repeat(501) } });
    expect(Array.from(input.value).length).toBe(500);
  });
});
