const MAX_TRACKED_CLIENTS = 10_000;

type FailureWindow = {
  failures: number;
  resetsAt: number;
};

export class FailedLoginLimiter {
  private readonly clients = new Map<string, FailureWindow>();

  constructor(
    private readonly maximumFailures: number,
    private readonly windowMilliseconds: number,
    private readonly now: () => number = Date.now,
  ) {}

  assertAllowed(clientKey: string): void {
    const current = this.activeWindow(clientKey);
    if (current && current.failures >= this.maximumFailures) {
      throw new Error('LOGIN_RATE_LIMITED');
    }
  }

  recordFailure(clientKey: string): void {
    const now = this.now();
    const current = this.activeWindow(clientKey, now);
    if (current) {
      current.failures += 1;
      return;
    }

    if (this.clients.size >= MAX_TRACKED_CLIENTS) {
      const oldestClient = this.clients.keys().next().value as string | undefined;
      if (oldestClient) this.clients.delete(oldestClient);
    }
    this.clients.set(clientKey, {
      failures: 1,
      resetsAt: now + this.windowMilliseconds,
    });
  }

  private activeWindow(clientKey: string, now = this.now()): FailureWindow | undefined {
    const current = this.clients.get(clientKey);
    if (!current) return undefined;
    if (current.resetsAt <= now) {
      this.clients.delete(clientKey);
      return undefined;
    }
    return current;
  }
}
