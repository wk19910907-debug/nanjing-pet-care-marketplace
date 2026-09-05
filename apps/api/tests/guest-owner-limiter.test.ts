import { describe, expect, it } from 'vitest';
import { GuestOwnerLimiter } from '../src/auth/guest-owner-limiter.js';

describe('guest owner limiter', () => {
  it('does not admit an already-aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    const limiter = new GuestOwnerLimiter();
    let ran = false;
    await expect(limiter.run(async () => { ran = true; }, controller.signal))
      .rejects.toThrow('GUEST_CREATION_ABORTED');
    expect(ran).toBe(false);
  });

  it('rechecks the create cap after queued admission', async () => {
    let release: (() => void) | undefined;
    const limiter = new GuestOwnerLimiter({ maximumConcurrent: 1, maximumQueued: 1, maximumCreates: 1 });
    const first = limiter.run(async () => new Promise<void>((resolve) => { release = resolve; }));
    const queued = limiter.run(async () => undefined);
    release!();
    await expect(first).resolves.toBeUndefined();
    await expect(queued).rejects.toThrow('GUEST_CREATION_RATE_LIMITED');
  });

  it('removes an aborted queued request and drains the next waiter', async () => {
    let release: (() => void) | undefined;
    const limiter = new GuestOwnerLimiter({ maximumConcurrent: 1, maximumQueued: 2, maximumCreates: 3 });
    const first = limiter.run(async () => new Promise<void>((resolve) => { release = resolve; }));
    const aborted = new AbortController();
    const canceled = limiter.run(async () => { throw new Error('must not run'); }, aborted.signal);
    const next = limiter.run(async () => 'ran');
    aborted.abort();
    release!();
    await expect(canceled).rejects.toThrow('GUEST_CREATION_ABORTED');
    await expect(first).resolves.toBeUndefined();
    await expect(next).resolves.toBe('ran');
  });
});
