import { describeCron, validateCron, assertValidCron } from '../../src/utils/cron';

describe('cron utilities', () => {
  describe('validateCron', () => {
    it.each(['30 9 * * *', '0 17 * * 5', '*/15 * * * *', '0 9 * * 1-5', '0 0 1 1 *'])(
      'accepts "%s"',
      (expression) => {
        expect(validateCron(expression).valid).toBe(true);
      },
    );

    it('accepts 6-field expressions with seconds', () => {
      expect(validateCron('0 30 9 * * *').valid).toBe(true);
    });

    it.each([
      ['', 'empty'],
      ['not a cron', 'garbage'],
      ['30 9 * *', 'too few fields'],
      ['99 9 * * *', 'minute out of range'],
      ['@daily', 'named schedule'],
    ])('rejects %s (%s)', (expression) => {
      expect(validateCron(expression).valid).toBe(false);
    });

    it('normalises redundant whitespace', () => {
      expect(validateCron('  30   9  *  *  * ').normalized).toBe('30 9 * * *');
    });
  });

  describe('assertValidCron', () => {
    it('returns the normalized expression', () => {
      expect(assertValidCron('30  9 * * *')).toBe('30 9 * * *');
    });

    it('throws with a reason for invalid input', () => {
      expect(() => assertValidCron('nope')).toThrow();
    });
  });

  describe('describeCron', () => {
    it('describes daily schedules', () => {
      expect(describeCron('30 9 * * *')).toBe('Every day at 09:30');
    });

    it('describes weekly schedules', () => {
      expect(describeCron('0 17 * * 5')).toBe('Every Friday at 17:00');
    });

    it('describes weekday ranges', () => {
      expect(describeCron('0 9 * * 1-5')).toBe('Monday–Friday at 09:00');
    });

    it('describes intervals', () => {
      expect(describeCron('*/15 * * * *')).toBe('Every 15 minutes');
    });

    it('flags invalid expressions', () => {
      expect(describeCron('bogus')).toBe('Invalid schedule');
    });
  });
});
