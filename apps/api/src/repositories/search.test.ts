import { describe, expect, it } from 'vitest';
import { parseSearchQuery } from './search.js';

describe('parseSearchQuery', () => {
  it('keeps letters of every script and digits, and treats operators as text', () => {
    expect(parseSearchQuery('Plan de la Semana')).toEqual({
      words: ['plan', 'de', 'la', 'semana'],
      phrases: [],
    });
    expect(parseSearchQuery('año 2026 — 東京')).toEqual({
      words: ['año', '2026', '東京'],
      phrases: [],
    });
    expect(parseSearchQuery("a & b | !c:* ) ' --")).toEqual({
      words: ['a', 'b', 'c'],
      phrases: [],
    });
    expect(parseSearchQuery(' !!! ')).toBeNull();
  });
  it('separates closed phrases from fuzzy prefixes without interpreting operators', () => {
    expect(parseSearchQuery('Ship "Plan day" & !soon:*')).toEqual({
      words: ['ship', 'soon'],
      phrases: ['Plan day'],
    });
    expect(parseSearchQuery('"plan:* | day"')).toEqual({ words: [], phrases: ['plan:* | day'] });
  });

  it('uses normal search while a quote is unfinished and ignores empty quotes', () => {
    expect(parseSearchQuery('ship "plan day')).toEqual({
      words: ['ship', 'plan', 'day'],
      phrases: [],
    });
    expect(parseSearchQuery('"" "!!!"')).toBeNull();
    expect(parseSearchQuery('"café azul" "東京 2026"')).toEqual({
      words: [],
      phrases: ['café azul', '東京 2026'],
    });
  });

  it('never truncates a complete phrase to the unquoted term budget', () => {
    const phrase = 'one two three four five six seven eight nine ten';
    expect(parseSearchQuery(`"${phrase}"`)).toEqual({ words: [], phrases: [phrase] });
    expect(parseSearchQuery(phrase)?.words).toHaveLength(8);
  });
});
