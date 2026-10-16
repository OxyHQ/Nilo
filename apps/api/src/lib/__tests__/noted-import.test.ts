/**
 * What a Noted note becomes in Nilo: its body's Markdown and its checklist as
 * blocks, its colour coerced as Noted did, its labels and folder mapped.
 */
import { describe, expect, it } from 'vitest';
import {
  foldersParentsFirst,
  type NotedNote,
  notedBlocks,
  notedColor,
  notedNoteToCreate,
} from '../noted-import.js';

const note = (fields: Partial<NotedNote> = {}): NotedNote => ({
  id: '01900000-0000-7000-8000-000000000001',
  oxyUserId: 'u',
  kind: 'note',
  title: 'Groceries',
  body: '',
  checklist: [],
  color: 'yellow',
  labels: [],
  folderId: null,
  pinned: false,
  archived: false,
  trashed: false,
  attachments: [],
  reminderAt: null,
  reminderSentAt: null,
  sortOrder: 3,
  createdAt: new Date('2026-09-01T10:00:00Z'),
  ...fields,
});

describe('notedBlocks', () => {
  it('turns the body and then the checklist into blocks, nested lists included', () => {
    const blocks = notedBlocks('## Weekend\n\n- milk\n  - oat\n\nThanks', [
      { id: 'c1', text: 'Bread', checked: true },
      { id: 'c2', text: '', checked: false },
    ]);
    expect(blocks.map((b) => [b.type, b.content.text])).toEqual([
      ['heading_2', 'Weekend'],
      ['bulleted_list_item', 'milk'],
      ['bulleted_list_item', 'oat'],
      ['paragraph', 'Thanks'],
      ['todo', 'Bread'],
    ]);
    const [, milk, oat] = blocks;
    expect(oat?.parentBlockId).toBe(milk?.id);
    expect(blocks.at(-1)?.content.checked).toBe(true);
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
  });

  it('gives an empty note no blocks', () => {
    expect(notedBlocks('   ', [])).toEqual([]);
  });
});

describe('notedColor', () => {
  it('keeps a colour Noted has, and coerces the legacy ones as Noted did', () => {
    expect(notedColor('teal')).toBe('teal');
    expect(notedColor('darkblue')).toBe('blue');
    expect(notedColor('amber')).toBe('pumpkin');
    expect(notedColor('gray')).toBe('default');
    expect(notedColor('chartreuse')).toBe('default');
  });
});

describe('notedNoteToCreate', () => {
  it('keeps the id and fields, maps labels and folder, and drops what did not come across', () => {
    const create = notedNoteToCreate(
      note({ labels: ['a', 'gone'], folderId: 'f', pinned: true, trashed: true, kind: 'voice' }),
      { labelIds: new Map([['a', 'A']]), folderIds: new Map([['f', 'F']]) },
      { artifacts: [], itemOverrides: [] },
    );
    expect(create).toMatchObject({
      id: '01900000-0000-7000-8000-000000000001',
      title: 'Groceries',
      color: 'yellow',
      labels: ['A'],
      folderId: 'F',
      pinned: true,
      trashed: true,
      kind: 'voice',
      order: 3,
      appData: { data: { artifacts: [], itemOverrides: [] }, baseRevision: 0 },
    });
  });
});

describe('foldersParentsFirst', () => {
  it('orders parents before children, and breaks a cycle at the top level', () => {
    const ordered = foldersParentsFirst([
      { id: 'c', name: 'C', parentId: 'b' },
      { id: 'b', name: 'B', parentId: 'a' },
      { id: 'a', name: 'A', parentId: null },
      { id: 'x', name: 'X', parentId: 'y' },
      { id: 'y', name: 'Y', parentId: 'x' },
    ]);
    expect(ordered.slice(0, 3).map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(ordered.slice(3).every((f) => f.parentId === null)).toBe(true);
  });
});
