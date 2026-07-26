import { RateLimiter } from '../../src/utils/rateLimiter';

describe('RateLimiter', () => {
  let now = 0;
  const clock = () => now;

  beforeEach(() => {
    now = 1_000_000;
  });

  it('allows up to capacity within a window', () => {
    const limiter = new RateLimiter({ capacity: 3, windowMs: 60_000, now: clock });
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);
  });

  it('refills tokens as time passes', () => {
    const limiter = new RateLimiter({ capacity: 2, windowMs: 1000, now: clock });
    limiter.tryConsume();
    limiter.tryConsume();
    expect(limiter.tryConsume()).toBe(false);

    now += 500; // half a window → one token
    expect(limiter.tryConsume()).toBe(true);
  });

  it('reports the wait time when exhausted', () => {
    const limiter = new RateLimiter({ capacity: 1, windowMs: 1000, now: clock });
    limiter.tryConsume();
    expect(limiter.msUntilAvailable()).toBeGreaterThan(0);
  });

  it('enforces a minimum gap between sends', () => {
    const limiter = new RateLimiter({ capacity: 10, windowMs: 60_000, minGapMs: 1500, now: clock });
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);
    now += 1500;
    expect(limiter.tryConsume()).toBe(true);
  });

  it('never exceeds capacity when idle for a long time', () => {
    const limiter = new RateLimiter({ capacity: 5, windowMs: 1000, now: clock });
    now += 10_000_000;
    expect(limiter.available).toBeLessThanOrEqual(5);
  });

  it('validates its options', () => {
    expect(() => new RateLimiter({ capacity: 0, windowMs: 1000 })).toThrow();
    expect(() => new RateLimiter({ capacity: 1, windowMs: 0 })).toThrow();
  });
});
