export type GuestOwnerLimiterOptions = { maximumConcurrent?: number; maximumQueued?: number; maximumCreates?: number; windowMilliseconds?: number; now?: () => number };

/** Bounded process-local protection; production additionally requires trusted shared ingress enforcement. */
export class GuestOwnerLimiter {
  private active = 0;
  private reservedCreates = 0;
  private readonly createdAt: number[] = [];
  private readonly maximumConcurrent: number;
  private readonly maximumQueued: number;
  private readonly maximumCreates: number;
  private readonly windowMilliseconds: number;
  private readonly now: () => number;
  private readonly queue: Array<{ resolve: () => void; reject: (error: Error) => void; signal?: AbortSignal; abort?: () => void }> = [];

  public constructor(options: GuestOwnerLimiterOptions = {}) {
    this.maximumConcurrent = options.maximumConcurrent ?? 8;
    this.maximumQueued = options.maximumQueued ?? 16;
    this.maximumCreates = options.maximumCreates ?? 100;
    this.windowMilliseconds = options.windowMilliseconds ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  public async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new Error('GUEST_CREATION_ABORTED');
    const now = this.now();
    while (this.createdAt[0] !== undefined && this.createdAt[0]! <= now - this.windowMilliseconds) this.createdAt.shift();
    if (this.createdAt.length + this.reservedCreates >= this.maximumCreates) throw new Error('GUEST_CREATION_RATE_LIMITED');
    if (this.active >= this.maximumConcurrent) {
      if (this.queue.length >= this.maximumQueued) throw new Error('GUEST_CREATION_RATE_LIMITED');
      await new Promise<void>((resolve, reject) => {
        const entry = { resolve, reject, signal } as { resolve: () => void; reject: (error: Error) => void; signal?: AbortSignal; abort?: () => void };
        entry.abort = () => {
          const index = this.queue.indexOf(entry);
          if (index >= 0) this.queue.splice(index, 1);
          reject(new Error('GUEST_CREATION_ABORTED'));
        };
        if (signal?.aborted) return entry.abort();
        signal?.addEventListener('abort', entry.abort, { once: true });
        this.queue.push(entry);
      });
      while (this.createdAt[0] !== undefined && this.createdAt[0]! <= this.now() - this.windowMilliseconds) this.createdAt.shift();
      if (signal?.aborted) {
        this.drain();
        throw new Error('GUEST_CREATION_ABORTED');
      }
      if (this.createdAt.length + this.reservedCreates >= this.maximumCreates) {
        this.drain();
        throw new Error('GUEST_CREATION_RATE_LIMITED');
      }
    }
    this.reservedCreates += 1;
    this.active += 1;
    try {
      const result = await operation();
      this.reservedCreates -= 1;
      this.createdAt.push(this.now());
      return result;
    } catch (error) {
      this.reservedCreates -= 1;
      throw error;
    } finally { this.active -= 1; this.drain(); }
  }

  private drain(): void {
    const entry = this.queue.shift();
    if (!entry) return;
    entry.signal?.removeEventListener('abort', entry.abort!);
    entry.resolve();
  }
}
