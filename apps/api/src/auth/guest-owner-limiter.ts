export type GuestOwnerLimiterOptions = { maximumConcurrent?: number; maximumQueued?: number; maximumCreates?: number; windowMilliseconds?: number; now?: () => number };

/** Bounded process-local protection; production additionally requires trusted shared ingress enforcement. */
export class GuestOwnerLimiter {
  private active = 0;
  private readonly createdAt: number[] = [];
  private readonly maximumConcurrent: number;
  private readonly maximumQueued: number;
  private readonly maximumCreates: number;
  private readonly windowMilliseconds: number;
  private readonly now: () => number;
  private readonly queue: Array<() => void> = [];

  public constructor(options: GuestOwnerLimiterOptions = {}) {
    this.maximumConcurrent = options.maximumConcurrent ?? 8;
    this.maximumQueued = options.maximumQueued ?? 16;
    this.maximumCreates = options.maximumCreates ?? 100;
    this.windowMilliseconds = options.windowMilliseconds ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  public async run<T>(operation: () => Promise<T>): Promise<T> {
    const now = this.now();
    while (this.createdAt[0] !== undefined && this.createdAt[0]! <= now - this.windowMilliseconds) this.createdAt.shift();
    if (this.createdAt.length >= this.maximumCreates) throw new Error('GUEST_CREATION_RATE_LIMITED');
    if (this.active >= this.maximumConcurrent) {
      if (this.queue.length >= this.maximumQueued) throw new Error('GUEST_CREATION_RATE_LIMITED');
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      const result = await operation();
      this.createdAt.push(this.now());
      return result;
    } finally { this.active -= 1; this.queue.shift()?.(); }
  }
}
