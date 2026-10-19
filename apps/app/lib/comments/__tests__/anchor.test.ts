import { anchorFor, locateAnchor, MAX_QUOTE_LENGTH } from '../anchor';

describe('anchorFor', () => {
  it('quotes the selected text, whichever way it was selected', () => {
    expect(anchorFor('Hello world', 6, 11)).toEqual({ start: 6, end: 11, quote: 'world' });
    expect(anchorFor('Hello world', 11, 6)).toEqual({ start: 6, end: 11, quote: 'world' });
  });

  it('has nothing to quote in a caret, blank text or too much of it', () => {
    expect(anchorFor('Hello', 2, 2)).toBeNull();
    expect(anchorFor('a   b', 1, 4)).toBeNull();
    expect(anchorFor('x'.repeat(MAX_QUOTE_LENGTH + 1), 0, MAX_QUOTE_LENGTH + 1)).toBeNull();
  });
});

describe('locateAnchor', () => {
  const anchor = { start: 6, end: 11, quote: 'world' };

  it('finds the text where it was', () => {
    expect(locateAnchor('Hello world', anchor)).toEqual({ start: 6, end: 11 });
  });

  it('follows it when edits before it moved it', () => {
    expect(locateAnchor('Oh, hello world', anchor)).toEqual({ start: 10, end: 15 });
  });

  it('takes the nearest of several', () => {
    const later = { start: 15, end: 20, quote: 'world' };
    expect(locateAnchor('world, hello world, world', later)).toEqual({ start: 13, end: 18 });
    expect(locateAnchor('world, hello world, world', anchor)).toEqual({ start: 0, end: 5 });
  });

  it('says when the text is gone', () => {
    expect(locateAnchor('Hello there', anchor)).toBeNull();
  });
});
