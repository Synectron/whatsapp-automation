import { extractPlaceholders, pickRandom, renderTemplate } from '../../src/utils/templating';

describe('templating', () => {
  it('substitutes known placeholders', () => {
    expect(renderTemplate('Hello {{name}}!', { name: 'Shubham' })).toBe('Hello Shubham!');
  });

  it('tolerates whitespace inside braces', () => {
    expect(renderTemplate('{{  name  }}', { name: 'x' })).toBe('x');
  });

  it('leaves unknown placeholders visible', () => {
    expect(renderTemplate('Hi {{missing}}', {})).toBe('Hi {{missing}}');
  });

  it('coerces numbers', () => {
    expect(renderTemplate('{{count}} items', { count: 3 })).toBe('3 items');
  });

  it('lists placeholders without duplicates', () => {
    expect(extractPlaceholders('{{a}} {{b}} {{a}}')).toEqual(['a', 'b']);
  });

  it('picks a member of the array', () => {
    const items = ['a', 'b', 'c'];
    expect(items).toContain(pickRandom(items));
  });

  it('returns undefined for an empty array', () => {
    expect(pickRandom([])).toBeUndefined();
  });
});
