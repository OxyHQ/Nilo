import { exportFilename, importSelection, MAX_IMPORT_BYTES } from '../page-transfer';

describe('export filenames', () => {
  it('prefers UTF-8 filenames and preserves accents and spaces', () => {
    expect(
      exportFilename(
        `attachment; filename="fallback.md"; filename*=UTF-8''Caf%C3%A9%20notes.md`,
        'page.md',
      ),
    ).toBe('Café notes.md');
  });
  it('supports quoted names, including semicolons and escaped quotes', () => {
    expect(exportFilename('attachment; filename="Notes; draft.html"', 'page.html')).toBe(
      'Notes; draft.html',
    );
    expect(exportFilename('attachment; filename="A\\"B.md"', 'page.md')).toBe('A"B.md');
  });
  it('falls back to the plain name if extended encoding is malformed', () => {
    expect(exportFilename(`attachment; filename="notes.md"; filename*=UTF-8''%XX`, 'page.md')).toBe(
      'notes.md',
    );
  });
  it('handles absent headers and removes paths and control characters', () => {
    expect(exportFilename(undefined, 'page.html')).toBe('page.html');
    expect(exportFilename(`attachment; filename*=UTF-8''..%2Fnotes%00.md`, 'page.md')).toBe(
      'notes.md',
    );
    expect(exportFilename('attachment; filename=".."', 'page.md')).toBe('page.md');
  });
});

describe('import selection', () => {
  it('accepts Markdown and HTML files or a single ZIP, case-insensitively', () => {
    expect(importSelection([{ name: 'Notes.MD' }, { name: 'Other.md' }])).toBe('files');
    expect(importSelection([{ name: 'Page.html' }, { name: 'Old.HTM' }])).toBe('files');
    expect(importSelection([{ name: 'Notes.md' }, { name: 'Page.html' }])).toBe('files');
    expect(importSelection([{ name: 'Notion.ZIP' }])).toBe('zip');
    expect(importSelection([{ name: 'Table.CSV' }])).toBe('csv');
  });
  it.each([
    [],
    [{ name: 'notes.md' }, { name: 'export.zip' }],
    [{ name: 'one.zip' }, { name: 'two.zip' }],
    [{ name: 'table.csv' }, { name: 'note.md' }],
    [{ name: 'one.csv' }, { name: 'two.csv' }],
    [{ name: 'page.html' }, { name: 'export.zip' }],
    [{ name: 'page.xhtml' }],
  ])('rejects unsupported and mixed selections: %j', (...assets) => {
    expect(() => importSelection(assets)).toThrow('invalidFiles');
  });
  it('rejects excessive combined size before reading file URIs', () => {
    expect(() =>
      importSelection([
        { name: 'a.md', size: MAX_IMPORT_BYTES },
        { name: 'b.md', size: 1 },
      ]),
    ).toThrow('tooLarge');
    expect(importSelection([{ name: 'a.zip', size: MAX_IMPORT_BYTES }])).toBe('zip');
  });
});
