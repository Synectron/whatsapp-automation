import { parsePhoneNumber, tryParsePhoneNumber, isGroupChatId, isIndividualChatId, PhoneNumberError } from '../../src/utils/phone';

describe('phone number parsing', () => {
  describe('with an explicit country code', () => {
    it.each([
      ['+919876543210', '919876543210'],
      ['+91 98765 43210', '919876543210'],
      ['+91-98765-43210', '919876543210'],
      ['0091 9876543210', '919876543210'],
      ['+1 (415) 555-2671', '14155552671'],
      ['+44 20 7946 0958', '442079460958'],
    ])('parses %s', (input, expected) => {
      expect(parsePhoneNumber(input, '91').digits).toBe(expected);
    });
  });

  describe('without a country code', () => {
    it('applies the configured default', () => {
      expect(parsePhoneNumber('9876543210', '91').digits).toBe('919876543210');
    });

    it('strips a national trunk prefix', () => {
      expect(parsePhoneNumber('09876543210', '91').digits).toBe('919876543210');
    });

    it('does not double-prefix a number that already carries the code', () => {
      expect(parsePhoneNumber('919876543210', '91').digits).toBe('919876543210');
    });

    it('refuses when no default is configured', () => {
      expect(() => parsePhoneNumber('9876543210', '')).toThrow(/country code/i);
    });
  });

  it('accepts an existing chat id unchanged', () => {
    expect(parsePhoneNumber('919876543210@c.us', '91').chatId).toBe('919876543210@c.us');
  });

  it('builds the chat id and display form', () => {
    const parsed = parsePhoneNumber('+91 98765 43210', '91');
    expect(parsed.chatId).toBe('919876543210@c.us');
    expect(parsed.display).toBe('+919876543210');
  });

  describe('rejections', () => {
    it.each([
      ['', /required/i],
      ['   ', /required/i],
      ['call me maybe', /letters/i],
      ['+91 1234', /too short/i],
      ['+91 12345678901234567', /too long/i],
      ['++++', /digits/i],
    ])('rejects "%s"', (input, expected) => {
      expect(() => parsePhoneNumber(input, '91')).toThrow(expected);
    });

    it('throws PhoneNumberError specifically', () => {
      expect(() => parsePhoneNumber('nope', '91')).toThrow(PhoneNumberError);
    });
  });

  describe('tryParsePhoneNumber', () => {
    it('returns null instead of throwing', () => {
      expect(tryParsePhoneNumber('garbage', '91')).toBeNull();
      expect(tryParsePhoneNumber('+919876543210', '91')?.digits).toBe('919876543210');
    });
  });

  describe('chat id predicates', () => {
    it('distinguishes individuals from groups', () => {
      expect(isIndividualChatId('919876543210@c.us')).toBe(true);
      expect(isIndividualChatId('120363000000@g.us')).toBe(false);
      expect(isGroupChatId('120363000000@g.us')).toBe(true);
      expect(isGroupChatId('919876543210@c.us')).toBe(false);
    });
  });
});
