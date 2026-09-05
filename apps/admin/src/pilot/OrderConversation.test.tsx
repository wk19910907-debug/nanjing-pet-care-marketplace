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

  it('loads labelled messages, supports manual refresh and stable later-message pagination', async () => {
    const api = fakeApi({ listOrderMessages: vi.fn().mockResolvedValueOnce({ items: [message], nextCursor: 'older-1' }).mockResolvedValueOnce({ items: [message], nextCursor: 'older-1' }).mockResolvedValueOnce({ items: [{ ...message, id: 'old-1', body: '更早消息' }], nextCursor: undefined }) });
    const user = userEvent.setup();
    render(<OrderConversation api={api} orderId={orderId} role="ADMIN" onError={() => '失败'}/>);
    expect(await screen.findByText(/宠主 · 请轻声敲门/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '刷新沟通记录' }));
    await user.click(await screen.findByRole('button', { name: '加载后续消息' }));
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

  it('locks the later-message control until its cursor request settles', async () => {
    const older = deferred<{ items: typeof message[] }>();
    const listOrderMessages = vi.fn().mockResolvedValueOnce({ items: [message], nextCursor: 'older-1' }).mockImplementationOnce(() => older.promise);
    const api = fakeApi({ listOrderMessages });
    const user = userEvent.setup();
    render(<OrderConversation api={api} orderId={orderId} role="OWNER" onError={() => '失败'}/>);
    const button = await screen.findByRole('button', { name: '加载后续消息' });
    await user.click(button); await user.click(button);
    expect(listOrderMessages).toHaveBeenCalledTimes(2);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => older.resolve({ items: [] }));
  });

  it('retains a confirmed send exactly once when an earlier initial request resolves afterwards', async () => {
    const initial = deferred<{ items: typeof message[]; nextCursor?: string }>();
    const sent = { ...message, id: 'message-sent', authorRole: 'OWNER' as const, body: '已确认发送' };
    const api = fakeApi({ listOrderMessages: vi.fn().mockImplementation(() => initial.promise), sendOrderMessage: vi.fn().mockResolvedValue(sent) });
    const user = userEvent.setup();
    render(<OrderConversation api={api} orderId={orderId} role="OWNER" onError={() => '失败'}/>);
    await user.type(screen.getByLabelText('订单沟通内容'), sent.body);
    await user.click(screen.getByRole('button', { name: '发送消息' }));
    expect(screen.getByText(/宠主 · 已确认发送/)).toBeTruthy();
    await act(async () => initial.resolve({ items: [message] }));
    expect(screen.getAllByText(/宠主 · 已确认发送/)).toHaveLength(1);
    expect(screen.getByText(/宠主 · 请轻声敲门/)).toBeTruthy();
  });

  it('keeps 51 ascending messages chronological and deduplicated across after-cursor pages', async () => {
    const all = Array.from({ length: 51 }, (_, index) => ({ ...message, id: `message-${index + 1}`, body: `消息 ${index + 1}`, createdAt: `2026-09-01T00:${String(index).padStart(2, '0')}:00.000Z` }));
    const api = fakeApi({ listOrderMessages: vi.fn().mockResolvedValueOnce({ items: all.slice(0, 50), nextCursor: 'after-50' }).mockResolvedValueOnce({ items: [all[49]!, all[50]!], nextCursor: undefined }) });
    const user = userEvent.setup();
    render(<OrderConversation api={api} orderId={orderId} role="ADMIN" onError={() => '失败'}/>);
    await user.click(await screen.findByRole('button', { name: '加载后续消息' }));
    await screen.findByText(/宠主 · 消息 51/);
    const bodies = Array.from(document.querySelectorAll('.pilot-message strong'), (item) => item.textContent);
    expect(bodies).toHaveLength(51);
    expect(bodies[0]).toContain('消息 1');
    expect(bodies.at(-1)).toContain('消息 51');
    expect(bodies.filter((body) => body?.includes('消息 50'))).toHaveLength(1);
  });

  it('releases a later-page lock and permits refresh then another page request', async () => {
    const later = deferred<{ items: typeof message[]; nextCursor?: string }>();
    const listOrderMessages = vi.fn()
      .mockResolvedValueOnce({ items: [message], nextCursor: 'after-1' })
      .mockImplementationOnce(() => later.promise)
      .mockResolvedValueOnce({ items: [message], nextCursor: 'after-1' })
      .mockResolvedValueOnce({ items: [{ ...message, id: 'message-2', body: '后续成功' }] });
    const api = fakeApi({ listOrderMessages });
    const user = userEvent.setup();
    render(<OrderConversation api={api} orderId={orderId} role="OWNER" onError={() => '失败'}/>);
    await user.click(await screen.findByRole('button', { name: '加载后续消息' }));
    expect((screen.getByRole('button', { name: '刷新沟通记录' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => later.resolve({ items: [{ ...message, id: 'message-2', body: '后续成功' }] }));
    await user.click(screen.getByRole('button', { name: '刷新沟通记录' }));
    await user.click(await screen.findByRole('button', { name: '加载后续消息' }));
    expect(await screen.findByText(/宠主 · 后续成功/)).toBeTruthy();
    expect(listOrderMessages).toHaveBeenCalledTimes(4);
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
