import {
  type BlockNode,
  blocksToHtml,
  blocksToHtmlBody,
  blocksToMarkdown,
  blocksToText,
  blocksToTree,
  markdownTitle,
  markdownToBlocks,
  mergeSegments,
  parseInline,
  renderInline,
  type Segment,
} from '@nilo/contracts';
import { describe, expect, it } from 'vitest';

/** Each non-space character with the marks it carries. */
const charMarks = (segments: Segment[]) =>
  segments.flatMap((s) =>
    [...s.text]
      .filter((ch) => ch.trim())
      .map(
        (ch) =>
          `${ch}:${s.bold ? 'b' : ''}${s.italic ? 'i' : ''}${s.strike ? 's' : ''}${s.code ? 'c' : ''}${s.link ?? ''}`,
      ),
  );

const shape = (nodes: BlockNode[]): unknown[] =>
  nodes.map((n) => [
    n.type,
    n.content.text ?? n.content.latex ?? n.content.url ?? null,
    shape(n.children),
  ]);

describe('parseInline', () => {
  it('reads the marks and safe links', () => {
    expect(parseInline('a **b** _c_ `d` ~~e~~ [f](https://x.test)')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' ' },
      { text: 'c', italic: true },
      { text: ' ' },
      { text: 'd', code: true },
      { text: ' ' },
      { text: 'e', strike: true },
      { text: ' ' },
      { text: 'f', link: 'https://x.test' },
    ]);
  });

  it('keeps unsafe links, escapes and intraword underscores as text', () => {
    expect(parseInline('[x](javascript:alert(1))')).toEqual([{ text: '[x](javascript:alert(1))' }]);
    expect(parseInline('\\*not bold\\*')).toEqual([{ text: '*not bold*' }]);
    expect(parseInline('snake_case_name')).toEqual([{ text: 'snake_case_name' }]);
  });
});

describe('renderInline', () => {
  it('round-trips random formatted text', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const words = ['plan', 'año', 'a*b', 'x_y', '`tick`', '[br]', 'end~', 'back\\slash'];
    for (let n = 0; n < 300; n += 1) {
      const segments: Segment[] = Array.from({ length: 1 + Math.floor(random() * 4) }, () => ({
        text: `${words[Math.floor(random() * words.length)]}${random() < 0.5 ? ' ' : ''}`,
        ...(random() < 0.3 && { bold: true }),
        ...(random() < 0.3 && { italic: true }),
        ...(random() < 0.2 && { strike: true }),
        ...(random() < 0.2 && { code: true }),
        ...(random() < 0.2 && { link: 'https://example.test/a' }),
      }));
      const expected = mergeSegments(segments);
      const back = parseInline(renderInline(expected));
      expect(back.map((s) => s.text).join('')).toBe(expected.map((s) => s.text).join(''));
      // And every visible character keeps its marks (whitespace may lose emphasis).
      expect(charMarks(back)).toEqual(charMarks(expected));
    }
  });
});

describe('markdownToBlocks', () => {
  it('reads structure: headings, nested lists, to-dos, code, quotes, callouts, tables, images', () => {
    const md = [
      '# Title is not a block here',
      'Para one',
      'still para one',
      '',
      '- item',
      '    - nested',
      '        1. deep',
      '- [x] done',
      '- [ ] open',
      '',
      '```ts',
      'const a = 1;',
      '```',
      '',
      '> quoted',
      '> on two lines',
      '',
      '> 💡 an idea',
      '',
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '![alt](https://img.test/a.png)',
      '',
      '---',
      '',
      '$$',
      'e = mc^2',
      '$$',
    ].join('\n');
    const blocks = markdownToBlocks(md);
    expect(shape(blocks)).toEqual([
      ['heading_1', 'Title is not a block here', []],
      ['paragraph', 'Para one\nstill para one', []],
      [
        'bulleted_list_item',
        'item',
        [['bulleted_list_item', 'nested', [['numbered_list_item', 'deep', []]]]],
      ],
      ['todo', 'done', []],
      ['todo', 'open', []],
      ['code', 'const a = 1;', []],
      ['quote', 'quoted\non two lines', []],
      ['callout', 'an idea', []],
      [
        'table',
        null,
        [
          [
            'table_row',
            null,
            [
              ['table_cell', 'A', []],
              ['table_cell', 'B', []],
            ],
          ],
          [
            'table_row',
            null,
            [
              ['table_cell', '1', []],
              ['table_cell', '2', []],
            ],
          ],
        ],
      ],
      ['image', 'https://img.test/a.png', []],
      ['divider', null, []],
      ['equation', 'e = mc^2', []],
    ]);
    expect(blocks[3]?.content.checked).toBe(true);
    expect(blocks[5]?.content.language).toBe('ts');
    expect(blocks[7]?.content.icon).toBe('emoji:💡');
  });

  it('takes a leading level-one heading as the title', () => {
    expect(markdownTitle('# My **page**\n\nbody')).toEqual({ title: 'My page', body: 'body' });
    expect(markdownTitle('no title').title).toBeNull();
  });
});

describe('blocksToMarkdown', () => {
  it('round-trips through markdownToBlocks', () => {
    const md = [
      '## Notes',
      '',
      'Some **bold** and [a link](https://x.test).',
      '',
      '- one',
      '    - two',
      '- [x] three',
      '',
      '1. first',
      '2. second',
      '',
      '```js',
      'x()',
      '```',
      '',
      '> a quote',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n');
    const blocks = markdownToBlocks(md);
    expect(shape(markdownToBlocks(blocksToMarkdown(blocks)))).toEqual(shape(blocks));
  });
});

describe('blocksToHtml', () => {
  it('escapes all text and refuses unsafe links', () => {
    const html = blocksToHtml(
      [
        {
          type: 'paragraph',
          content: {
            text: '<script>alert(1)</script>',
            segments: [
              { text: '<script>alert(1)</script>' },
              { text: 'x', link: 'javascript:alert(1)' },
            ],
          },
          children: [],
        },
      ],
      'A <b>title</b>',
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<title>A &lt;b&gt;title&lt;/b&gt;</title>');
    expect(html).not.toContain('javascript:');
  });
});

describe('blocksToText and blocksToHtmlBody', () => {
  const tree = blocksToTree([
    { id: 'h', parentBlockId: null, type: 'heading_1', content: { text: 'Plan' }, order: 1 },
    {
      id: 'p',
      parentBlockId: null,
      type: 'paragraph',
      content: { segments: [{ text: 'Uno  ' }, { text: 'dos', bold: true }] },
      order: 2,
    },
    { id: 'c', parentBlockId: 'p', type: 'paragraph', content: { text: 'tres <b>' }, order: 1 },
  ]);

  it('reads the text in order, one space between blocks', () => {
    expect(blocksToText(tree)).toBe('Plan Uno dos tres <b>');
  });

  it('cuts at a word near the limit', () => {
    expect(blocksToText(tree, 12)).toBe('Plan Uno…');
    expect(blocksToText(tree, 12).length).toBeLessThanOrEqual(12);
  });

  it('renders the body escaped, without a document around it', () => {
    const html = blocksToHtmlBody(tree);
    expect(html).toContain('<h1>Plan</h1>');
    expect(html).toContain('tres &lt;b&gt;');
    expect(html).not.toContain('<html');
  });
});
