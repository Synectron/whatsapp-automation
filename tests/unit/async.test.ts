import { backoffDelay, retry, withTimeout, sleep } from '../../src/utils/async';

describe('async utilities', () => {
  describe('backoffDelay', () => {
    it('grows exponentially', () => {
      expect(backoffDelay(1, 1000, 60_000)).toBe(1000);
      expect(backoffDelay(2, 1000, 60_000)).toBe(2000);
      expect(backoffDelay(3, 1000, 60_000)).toBe(4000);
    });

    it('clamps to the maximum', () => {
      expect(backoffDelay(20, 1000, 30_000)).toBe(30_000);
    });

    it('stays within bounds when jittered', () => {
      for (let i = 0; i < 50; i += 1) {
        const delay = backoffDelay(3, 1000, 60_000, 2, true);
        expect(delay).toBeGreaterThanOrEqual(2000);
        expect(delay).toBeLessThanOrEqual(4000);
      }
    });
  });

  describe('retry', () => {
    it('returns the first successful result', async () => {
      const fn = jest.fn().mockResolvedValue('ok');
      await expect(retry(fn, { attempts: 3 })).resolves.toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries until success', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue('recovered');
      await expect(retry(fn, { attempts: 3, baseDelayMs: 1, jitter: false })).resolves.toBe('recovered');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('gives up after the configured attempts', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('always fails'));
      await expect(retry(fn, { attempts: 3, baseDelayMs: 1, jitter: false })).rejects.toThrow('always fails');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('honours shouldRetry', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fatal'));
      await expect(
        retry(fn, { attempts: 5, baseDelayMs: 1, shouldRetry: () => false }),
      ).rejects.toThrow('fatal');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('withTimeout', () => {
    it('resolves fast promises', async () => {
      await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
    });

    it('rejects slow promises', async () => {
      await expect(withTimeout(sleep(200), 20, 'slow op')).rejects.toThrow('slow op timed out after 20ms');
    });
  });
});
