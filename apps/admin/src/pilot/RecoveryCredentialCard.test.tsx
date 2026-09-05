// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecoveryCredentialCard } from './RecoveryCredentialCard.js';

describe('RecoveryCredentialCard', () => {
  afterEach(() => cleanup());

  it('keeps the recovery credential masked until an explicit copy action', async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    const onClose = vi.fn();
    render(<RecoveryCredentialCard
      credential={{ userId: '11111111-1111-4111-8111-111111111111', token: 'A'.repeat(43), recoveryPath: '/#/orders/access/' + 'A'.repeat(43) }}
      onClose={onClose}
    />);

    expect(screen.getByRole('heading', { name: '保存你的恢复凭据' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '复制恢复链接' }));
    expect(document.body.textContent).not.toContain('A'.repeat(43));
    await userEvent.click(screen.getByRole('button', { name: '复制恢复链接' }));
    expect(copy).toHaveBeenCalledWith(`${window.location.origin}/#/orders/access/${'A'.repeat(43)}`);
    await userEvent.click(screen.getByRole('button', { name: '我已保存' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
