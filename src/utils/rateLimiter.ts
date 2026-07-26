/**
 * Token-bucket rate limiter with an additional minimum gap between actions.
 * Used to keep outgoing WhatsApp traffic well below anything that looks like
 * spam, and unit-testable via the injectable clock.
 */
export interface RateLimiterOptions {
  /** Tokens (messages) allowed per window. */
  capacity: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Minimum delay enforced between two consecutive consumptions. */
  minGapMs?: number;
  /** Injectable clock, defaults to Date.now (useful in tests). */
  now?: () => number;
}

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private lastConsumed = 0;
  private readonly capacity: number;
  private readonly windowMs: number;
  private readonly minGapMs: number;
  private readonly now: () => number;

  constructor(options: RateLimiterOptions) {
    if (options.capacity <= 0) throw new Error('RateLimiter capacity must be > 0');
    if (options.windowMs <= 0) throw new Error('RateLimiter windowMs must be > 0');
    this.capacity = options.capacity;
    this.windowMs = options.windowMs;
    this.minGapMs = options.minGapMs ?? 0;
    this.now = options.now ?? Date.now;
    this.tokens = options.capacity;
    this.lastRefill = this.now();
  }

  private refill(): void {
    const now = this.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    const refillRate = this.capacity / this.windowMs; // tokens per ms
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * refillRate);
    this.lastRefill = now;
  }

  /** Milliseconds to wait before a token becomes available (0 when ready). */
  public msUntilAvailable(): number {
    this.refill();
    const gapWait = Math.max(0, this.minGapMs - (this.now() - this.lastConsumed));
    if (this.tokens >= 1) return gapWait;
    const refillRate = this.capacity / this.windowMs;
    const tokenWait = Math.ceil((1 - this.tokens) / refillRate);
    return Math.max(tokenWait, gapWait);
  }

  /** Consumes a token when available. Returns false when rate limited. */
  public tryConsume(): boolean {
    if (this.msUntilAvailable() > 0) return false;
    this.tokens -= 1;
    this.lastConsumed = this.now();
    return true;
  }

  /** Current (fractional) token balance — exposed for observability. */
  public get available(): number {
    this.refill();
    return this.tokens;
  }
}
