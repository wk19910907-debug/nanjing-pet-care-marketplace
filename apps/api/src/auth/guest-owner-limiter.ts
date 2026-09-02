export type GuestOwnerLimiterOptions = { maximumConcurrent?: number; maximumCreates?: number; windowMilliseconds?: number };

/** Bounded process-local protection; production additionally requires trusted shared ingress enforcement. */
export class GuestOwnerLimiter {
  private active = 0;
  private readonly createdAt: number[] = [];
  private readonly maximumConcurrent: number;
  private readonly maximumCreates: number;
  private readonly windowMilliseconds: number;

  public constructor(options: GuestOwnerLimiterOptions = {}) {
    this.maximumConcurrent = options.maximumConcurrent ?? 8;
    this.maximumCreates = options.maximumCreates ?? 100;
    this.windowMilliseconds = options.windowMilliseconds ?? 60_000;
  }

  public async run<T>(operation: () => Promise<T>): Promise<T> {
    const now = Date.now();
    while (this.createdAt[0] !== undefined && this.createdAt[0]! <= now - this.windowMilliseconds) this.createdAt.shift();
    if (this.active >= this.maximumConcurrent || this.createdAt.length >= this.maximumCreates) throw new Error('GUEST_CREATION_RATE_LIMITED');
    this.active += 1;
    try {
      const result = await operation();
      this.createdAt.push(now);
      return result;
    } finally { this.active -= 1; }
  }
}
