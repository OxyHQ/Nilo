import { describe, expect, it } from 'vitest';
import { fingerprintOf, fold, type Memory, rank, textScore } from './memories.js';

const NOW = Date.parse('2026-11-07T12:00:00Z');

function memory(over: Partial<Memory>): Memory {
  return {
    id: 'm',
    title: '',
    detail: '',
    kind: null,
    tags: [],
    source: '',
    importance: 3,
    pinned: false,
    archived: false,
    lastUsedAt: '2026-11-07T12:00:00Z',
    createdAt: '2026-11-07T12:00:00Z',
    updatedAt: '2026-11-07T12:00:00Z',
    ...over,
  };
}

describe('memory text', () => {
  it('folds case, accents and whitespace', () => {
    expect(fold('  Prefiere  CAFÉ\tsolo ')).toBe('prefiere cafe solo');
  });

  it('gives one fingerprint to the same fact however it is written', () => {
    expect(fingerprintOf('Prefiere café solo')).toBe(fingerprintOf('  prefiere CAFE   solo '));
    expect(fingerprintOf('Prefiere café solo')).not.toBe(fingerprintOf('Prefiere té'));
  });
});

describe('memory ranking', () => {
  it('scores a title match above a tag match above a detail match', () => {
    const title = memory({ title: 'Uses Postgres' });
    const tag = memory({ title: 'Database choice', tags: ['postgres'] });
    const detail = memory({ title: 'Database choice', detail: 'we picked postgres' });
    const words = ['postgres'];
    expect(textScore(title, words)).toBeGreaterThan(textScore(tag, words));
    expect(textScore(tag, words)).toBeGreaterThan(textScore(detail, words));
  });

  it('scores a memory with none of the words at zero', () => {
    expect(textScore(memory({ title: 'Likes tea' }), ['postgres'])).toBe(0);
  });

  it('lets importance, pinning and recency separate equally relevant memories', () => {
    const words = ['postgres'];
    const base = { title: 'Uses Postgres' };
    const plain = memory({ ...base });
    const important = memory({ ...base, importance: 5 });
    const pinned = memory({ ...base, pinned: true });
    const stale = memory({ ...base, lastUsedAt: '2025-01-01T00:00:00Z' });
    expect(rank(important, words, NOW)).toBeGreaterThan(rank(plain, words, NOW));
    expect(rank(pinned, words, NOW)).toBeGreaterThan(rank(plain, words, NOW));
    expect(rank(stale, words, NOW)).toBeLessThan(rank(plain, words, NOW));
  });

  it('does not let importance outrank a clearly more relevant memory', () => {
    const words = ['postgres', 'migrations'];
    const relevant = memory({ title: 'Postgres migrations run in two phases', importance: 2 });
    const important = memory({ title: 'Likes tea', importance: 5, pinned: true });
    expect(rank(relevant, words, NOW)).toBeGreaterThan(rank(important, words, NOW));
  });
});
