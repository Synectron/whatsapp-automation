import { isWithinQuietHours, localDateKey, localHour, minuteKey } from '../../src/utils/time';

describe('time helpers', () => {
  const instant = new Date('2026-07-26T18:45:00.000Z'); // 00:15 IST on the 27th

  it('formats the local date key in the configured timezone', () => {
    expect(localDateKey(instant, 'Asia/Kolkata')).toBe('2026-07-27');
    expect(localDateKey(instant, 'UTC')).toBe('2026-07-26');
  });

  it('returns the local hour', () => {
    expect(localHour(instant, 'Asia/Kolkata')).toBe(0);
    expect(localHour(instant, 'UTC')).toBe(18);
  });

  it('builds a minute-precision dedupe key', () => {
    expect(minuteKey(instant, 'UTC')).toBe('2026-07-26T18:45');
  });

  describe('isWithinQuietHours', () => {
    it('handles wrap-around windows', () => {
      expect(isWithinQuietHours(23, 22, 8)).toBe(true);
      expect(isWithinQuietHours(3, 22, 8)).toBe(true);
      expect(isWithinQuietHours(12, 22, 8)).toBe(false);
    });

    it('handles same-day windows', () => {
      expect(isWithinQuietHours(13, 12, 14)).toBe(true);
      expect(isWithinQuietHours(15, 12, 14)).toBe(false);
    });

    it('is disabled when start equals end', () => {
      expect(isWithinQuietHours(5, 8, 8)).toBe(false);
    });
  });
});
