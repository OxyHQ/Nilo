import { uuidv7 } from '@oxy.so/db';
import { describe, expect, it } from 'vitest';
import { readNavigationCursor } from './navigation-neighbors.js';

describe('navigation cursor', () => {
  it('accepts only continuations for the same anchor location', () => {
    const after = { id: uuidv7(), kind: 'page' };
    const cursor = Buffer.from(JSON.stringify({ scope: 'one', after })).toString('base64url');
    expect(readNavigationCursor(undefined, 'one')).toBeNull();
    expect(readNavigationCursor(cursor, 'one')).toEqual(after);
    expect(() => readNavigationCursor(cursor, 'moved')).toThrow('Invalid navigation cursor');
  });
  it('rejects malformed cursors and non-resource IDs', () => {
    for (const value of ['!', 'null', '{}', JSON.stringify({ scope: 'one', after: 'bad' })]) {
      expect(() => readNavigationCursor(Buffer.from(value).toString('base64url'), 'one')).toThrow();
    }
  });
});
