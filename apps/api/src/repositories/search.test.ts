import { describe, expect, it } from 'vitest';
import { prefixQuery } from './search.js';

describe('prefixQuery', () => {
  it('turns words into required prefixes', () => {
    expect(prefixQuery('Plan de la Semana')).toBe('plan:* & de:* & la:* & semana:*');
  });

  it('keeps letters of every script and digits, and nothing else', () => {
    expect(prefixQuery('año 2026 — 東京')).toBe('año:* & 2026:* & 東京:*');
    expect(prefixQuery("a & b | !c:* ) ' --")).toBe('a:* & b:* & c:*');
  });

  it('is null when there is no word to look for', () => {
    expect(prefixQuery('  !!! ')).toBeNull();
  });
});
