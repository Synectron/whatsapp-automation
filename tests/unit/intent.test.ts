import { detectIntent, fallbackReply } from '../../src/ai/intent';

describe('intent detection', () => {
  it.each([
    ["I'm blocked", 'blocked'],
    ['Still stuck on the migration', 'blocked'],
    ['Waiting for API credentials.', 'waiting'],
    ['Awaiting the design review', 'waiting'],
    ['Can someone help with the deploy?', 'help_request'],
    ['Done with the login screen', 'update'],
    ['Should we ship today?', 'question'],
    ['ok', 'other'],
  ])('classifies "%s" as %s', (message, expected) => {
    expect(detectIntent(message)).toBe(expected);
  });

  it('treats empty input as other', () => {
    expect(detectIntent('')).toBe('other');
  });

  describe('fallbackReply', () => {
    it('asks blocked members for detail', () => {
      expect(fallbackReply('blocked', 'Asha')).toContain('blocked on');
    });

    it('offers a follow-up reminder when waiting', () => {
      expect(fallbackReply('waiting')).toContain('remind the group again tomorrow');
    });

    it('stays silent for neutral messages', () => {
      expect(fallbackReply('other')).toBeNull();
      expect(fallbackReply('update')).toBeNull();
    });
  });
});
