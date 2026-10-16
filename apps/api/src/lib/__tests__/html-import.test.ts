import {
  type BlockContent,
  type BlockNode,
  type BlockType,
  blocksToHtml,
  blocksToHtmlBody,
  markdownToBlocks,
  type Segment,
} from '@oxy.so/nilo-contracts';
import { describe, expect, it } from 'vitest';
import { HtmlTooDeepError, htmlToBlocks, MAX_HTML_DEPTH, readHtmlPage } from '../html-import.js';

const node = (type: BlockType, content: BlockContent, children: BlockNode[] = []): BlockNode => ({
  type,
  content,
  children,
});
/** Text content as markdownToBlocks writes it; `segments` when the text has marks. */
const text = (value: string, segments?: Segment[]): BlockContent => {
  const runs = segments ?? (value ? [{ text: value }] : []);
  return { text: runs.map((s) => s.text).join(''), segments: runs };
};
const p = (value: string) => node('paragraph', text(value));

describe('htmlToBlocks', () => {
  it('reads every block type', () => {
    const blocks = htmlToBlocks(`
      <h1>One</h1><h2>Two</h2><h3>Three</h3><h5>Five</h5>
      <p>Para</p>
      <ul><li>a<ul><li>a.1</li></ul></li><li>b</li></ul>
      <ol><li>first</li><li>second</li></ol>
      <ul>
        <li><input type="checkbox" checked> done</li>
        <li><input type="checkbox"> open</li>
      </ul>
      <blockquote>Quoted</blockquote>
      <aside class="callout"><span class="icon">🔥</span> <div>Hot</div></aside>
      <pre><code class="language-TypeScript">const a = 1;
  if (a) {}
</code></pre>
      <pre>plain  text</pre>
      <hr>
      <details><summary>More</summary><p>Hidden</p></details>
      <table><thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td>c1</td></tr></tbody></table>
      <figure><img src="https://img.test/a.png" alt="An image"><figcaption>Cap</figcaption></figure>
      <img src="data:image/png;base64,AAAA">
      <iframe src="https://www.youtube.com/embed/x"></iframe>
      <video src="https://media.test/v.mp4"></video>
      <div class="equation">E = mc^2</div>
      <div class="columns"><div class="column"><p>Left</p></div><div class="column"><p>Right</p></div></div>
    `);
    expect(blocks).toEqual([
      node('heading_1', text('One')),
      node('heading_2', text('Two')),
      node('heading_3', text('Three')),
      node('heading_3', text('Five')),
      p('Para'),
      node('bulleted_list_item', text('a'), [node('bulleted_list_item', text('a.1'))]),
      node('bulleted_list_item', text('b')),
      node('numbered_list_item', text('first')),
      node('numbered_list_item', text('second')),
      node('todo', { ...text('done'), checked: true }),
      node('todo', { ...text('open'), checked: false }),
      node('quote', text('Quoted')),
      node('callout', { ...text('Hot'), icon: 'emoji:🔥' }),
      node('code', { text: 'const a = 1;\n  if (a) {}', language: 'typescript' }),
      node('code', { text: 'plain  text', language: 'plain' }),
      node('divider', {}),
      node('toggle', { ...text('More'), expanded: false }, [p('Hidden')]),
      node('table', { rows: 2, cols: 2, withHeader: true }, [
        node('table_row', {}, [node('table_cell', text('H1')), node('table_cell', text('H2'))]),
        node('table_row', {}, [node('table_cell', text('c1')), node('table_cell', text(''))]),
      ]),
      node('image', { url: 'https://img.test/a.png', alt: 'An image', caption: 'Cap' }),
      node('embed', { url: 'https://www.youtube.com/embed/x' }),
      node('video', { url: 'https://media.test/v.mp4' }),
      node('equation', { latex: 'E = mc^2' }),
      node('columns', { columnCount: 2 }, [
        node('column', {}, [p('Left')]),
        node('column', {}, [p('Right')]),
      ]),
    ]);
  });

  it('reads inline marks, links and inline styles', () => {
    const [block] = htmlToBlocks(
      '<p>a <b>bold</b> <strong><em>both</em></strong> <i>it</i> <u>under</u> <s>gone</s> ' +
        '<del>del</del> <code>x()</code> <kbd>K</kbd> <a href="https://x.test/?a=1&amp;b=2">link <b>bl</b></a> ' +
        '<span style="font-weight: 700">heavy</span> <span style="font-style:italic">slant</span> ' +
        '<span style="text-decoration: underline line-through">both2</span> ' +
        '<span style="border-bottom:0.05em solid">notion</span></p>',
    );
    expect(block?.content.segments).toEqual([
      { text: 'a ' },
      { text: 'bold', bold: true },
      { text: ' ' },
      { text: 'both', bold: true, italic: true },
      { text: ' ' },
      { text: 'it', italic: true },
      { text: ' ' },
      { text: 'under', underline: true },
      { text: ' ' },
      { text: 'gone', strike: true },
      { text: ' ' },
      { text: 'del', strike: true },
      { text: ' ' },
      { text: 'x()', code: true },
      { text: ' ' },
      { text: 'K', code: true },
      { text: ' ' },
      { text: 'link ', link: 'https://x.test/?a=1&b=2' },
      { text: 'bl', bold: true, link: 'https://x.test/?a=1&b=2' },
      { text: ' ' },
      { text: 'heavy', bold: true },
      { text: ' ' },
      { text: 'slant', italic: true },
      { text: ' ' },
      { text: 'both2', underline: true, strike: true },
      { text: ' ' },
      { text: 'notion', underline: true },
    ]);
    expect(block?.content.text).toBe(
      'a bold both it under gone del x() K link bl heavy slant both2 notion',
    );
  });

  it('keeps only safe links', () => {
    const [block] = htmlToBlocks(
      '<p><a href="javascript:alert(1)">js</a> <a href=" JaVaScRiPt:x">js2</a> ' +
        '<a href="data:text/html,x">data</a> <a href="mailto:a@b.test">mail</a> <a href="/p/1">rel</a> ' +
        '<a href="other.html">file</a></p>',
    );
    expect(block?.content.segments).toEqual([
      { text: 'js js2 data ' },
      { text: 'mail', link: 'mailto:a@b.test' },
      { text: ' ' },
      { text: 'rel', link: '/p/1' },
      { text: ' file' },
    ]);
  });

  it('cancels bold the way Google Docs wraps everything in <b style="font-weight:normal">', () => {
    expect(
      htmlToBlocks(
        '<b style="font-weight:normal"><p>plain <span style="font-weight:700">b</span></p></b>',
      ),
    ).toEqual([
      node('paragraph', text('plain b', [{ text: 'plain ' }, { text: 'b', bold: true }])),
    ]);
  });

  it('collapses whitespace like a browser', () => {
    expect(
      htmlToBlocks(`
        <p>
          Lots   of
          space <b> bold </b>  after
        </p>
        <p>line<br>  break <br></p>
        <p>   </p>
        <div style="white-space: pre-wrap">kept   as  is</div>
      `),
    ).toEqual([
      node(
        'paragraph',
        text('Lots of space bold after', [
          { text: 'Lots of space ' },
          { text: 'bold ', bold: true },
          { text: 'after' },
        ]),
      ),
      p('line\nbreak'),
      p('kept   as  is'),
    ]);
  });

  it('decodes entities', () => {
    expect(
      htmlToBlocks('<p>&lt;tag&gt; &amp; &quot;q&quot; &#x1F600; caf&eacute;&nbsp;!</p>'),
    ).toEqual([p('<tag> & "q" 😀 café !')]);
  });

  it('drops scripts, styles, comments and form controls', () => {
    expect(
      htmlToBlocks(
        '<script>alert(1)</script><style>p{}</style><!-- note --><p>Kept<script>x()</script></p>' +
          '<noscript>no</noscript><template><p>t</p></template><select><option>o</option></select>' +
          '<textarea>ta</textarea><svg><text>s</text></svg>',
      ),
    ).toEqual([p('Kept')]);
  });

  it('reads unknown elements as their text', () => {
    expect(
      htmlToBlocks(
        '<my-widget>Hello <x-b>there</x-b></my-widget><section><nav>Menu</nav></section>',
      ),
    ).toEqual([p('Hello there'), p('Menu')]);
  });

  it('survives unclosed and misnested tags', () => {
    expect(htmlToBlocks('<p>one<p>two <b>bold <i>both</b> italic</i><ul><li>a<li>b')).toEqual([
      p('one'),
      node(
        'paragraph',
        text('two bold both italic', [
          { text: 'two ' },
          { text: 'bold ', bold: true },
          { text: 'both', bold: true, italic: true },
          { text: ' italic', italic: true },
        ]),
      ),
      node('bulleted_list_item', text('a')),
      node('bulleted_list_item', text('b')),
    ]);
  });

  it('nests a list written straight inside a list under the item before it', () => {
    expect(htmlToBlocks('<ul><li>a</li><ul><li>b</li></ul></ul>')).toEqual([
      node('bulleted_list_item', text('a'), [node('bulleted_list_item', text('b'))]),
    ]);
  });

  it('takes a list item’s first paragraph as its text', () => {
    expect(htmlToBlocks('<ol><li><p>Item</p><p>More</p></li></ol>')).toEqual([
      node('numbered_list_item', text('Item'), [p('More')]),
    ]);
  });

  it('reads nesting up to the limit, and refuses deeper documents', () => {
    const depth = MAX_HTML_DEPTH - 5;
    const deep = htmlToBlocks(`${'<div>'.repeat(depth)}deep${'</div>'.repeat(depth)}`);
    expect(deep).toEqual([p('deep')]);
    const lists = htmlToBlocks(`${'<ul><li>x'.repeat(60)}`);
    let depthOf = 0;
    for (let b = lists[0]; b; b = b.children[0]) depthOf += 1;
    expect(depthOf).toBe(60);

    const started = Date.now();
    expect(() => htmlToBlocks(`${'<div>'.repeat(10_000)}x`)).toThrow(HtmlTooDeepError);
    expect(() => htmlToBlocks(`${'<b>'.repeat(10_000)}x`)).toThrow(HtmlTooDeepError);
    expect(() => htmlToBlocks(`${'<ul><li>'.repeat(10_000)}x`)).toThrow(HtmlTooDeepError);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('readHtmlPage', () => {
  it('takes the title from <title> and drops a leading <h1> that repeats it', () => {
    expect(readHtmlPage('<title> My  page </title><h1>My page</h1><p>Body</p>')).toEqual({
      title: 'My page',
      blocks: [p('Body')],
      databases: [],
      isDatabase: false,
    });
    expect(readHtmlPage('<title>Doc</title><h1>Other</h1>').blocks).toEqual([
      node('heading_1', text('Other')),
    ]);
  });

  it('else from a leading <h1>, which is then not a block', () => {
    const page = readHtmlPage('<h1>Heading <b>title</b></h1><p>Body</p>');
    expect(page.title).toBe('Heading title');
    expect(page.blocks).toEqual([p('Body')]);
  });

  it('else has none: an <h1> after other content stays', () => {
    const page = readHtmlPage('<p>Intro</p><h1>Later</h1>');
    expect(page.title).toBeNull();
    expect(page.blocks).toEqual([p('Intro'), node('heading_1', text('Later'))]);
  });

  it('reads a Notion page export', () => {
    const page = readHtmlPage(
      `<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"/><title>Getting Started</title><style>/* cspell:disable-file */ .page { padding: 0 }</style></head><body><article id="a1" class="page sans"><header><div class="page-header-icon undefined"><span class="icon">👋</span></div><h1 class="page-title">Getting Started</h1><p class="page-description"></p><table class="properties"><tbody><tr class="property-row"><th>Tags</th><td>x</td></tr></tbody></table></header><div class="page-body"><p id="b1" class="">Welcome to <strong>Notion</strong>!</p><p id="b2" class=""></p><h2 id="b3" class="">Basics</h2><ul id="b4" class="to-do-list"><li><div class="checkbox checkbox-off"></div> <span class="to-do-children-unchecked">Click anywhere</span><div class="indented"><p id="b5" class="">Nested</p></div></li></ul><ul id="b6" class="to-do-list"><li><div class="checkbox checkbox-on"></div> <span class="to-do-children-checked">Done</span><div class="indented"></div></li></ul><ul id="b7" class="bulleted-list"><li style="list-style-type:disc">Bullet<ul id="b8" class="bulleted-list"><li style="list-style-type:circle">Sub</li></ul></li></ul><ol type="1" id="b9" class="numbered-list" start="1"><li>One</li></ol><ol type="1" id="b10" class="numbered-list" start="2"><li>Two</li></ol><ul id="b11" class="toggle"><li><details open=""><summary>Toggle me</summary><p id="b12" class="">Inside</p></details></li></ul><figure class="block-color-gray_background callout" style="white-space:pre-wrap;display:flex" id="b13"><div style="font-size:1.5em"><span class="icon">💡</span></div><div style="width:100%">Tip: <em>read</em> this</div></figure><blockquote id="b14" class="">A quote</blockquote><hr id="b15"/><pre id="b16" class="code code-wrap"><code class="language-JavaScript" style="white-space:pre-wrap;word-break:break-all">let x = 1;</code></pre><pre id="b16b" class="code"><code class="language-Plain Text">plain</code></pre><figure id="b17" class="image"><a href="Getting%20Started%20abc/Untitled.png"><img style="width:240px" src="Getting%20Started%20abc/Untitled.png"/></a></figure><figure id="b18" class="image"><a href="https://images.test/x.png"><img src="https://images.test/x.png"/></a><figcaption>External</figcaption></figure><figure id="b19" class="link-to-page"><a href="Getting%20Started%200123456789abcdef0123456789abcdef/Sub%20page%20fedcba9876543210fedcba9876543210.html"><span class="icon">📄</span>Sub page</a></figure><figure id="b20"><a href="https://nilo.test/" class="bookmark source"><div class="bookmark-info"><div class="bookmark-text"><div class="bookmark-title">Nilo</div><div class="bookmark-description">Docs</div></div><div class="bookmark-href">https://nilo.test/</div></div></a></figure><figure id="b21"><div class="source"><a href="Getting%20Started%20abc/report.pdf">report.pdf</a></div></figure><figure id="b22" class="equation"><style>@import url('https://cdn.test/katex.css')</style><div class="equation-container"><span class="katex-display"><span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">x2</span></span></span></div></figure><p id="b23">Inline <span class="notion-text-equation-token"><span class="katex"><span class="katex-mathml"><math><annotation encoding="application/x-tex">y</annotation></math></span><span class="katex-html">y</span></span></span> math</p><table id="b24" class="simple-table"><tbody><tr id="r1"><td id="c1" class="">a</td><td id="c2" class="">b</td></tr></tbody></table><div id="b25" class="column-list"><div id="b26" style="width:50%" class="column"><p id="b27">L</p></div><div id="b28" style="width:50%" class="column"><p id="b29">R</p></div></div></div></article><span class="sans" style="font-size:14px;padding-top:2em"></span></body></html>`,
    );
    expect(page.title).toBe('Getting Started');
    expect(page.isDatabase).toBe(false);
    expect(page.databases).toEqual([]);
    expect(page.blocks).toEqual([
      node(
        'paragraph',
        text('Welcome to Notion!', [
          { text: 'Welcome to ' },
          { text: 'Notion', bold: true },
          { text: '!' },
        ]),
      ),
      node('heading_2', text('Basics')),
      node('todo', { ...text('Click anywhere'), checked: false }, [p('Nested')]),
      node('todo', { ...text('Done'), checked: true }),
      node('bulleted_list_item', text('Bullet'), [node('bulleted_list_item', text('Sub'))]),
      node('numbered_list_item', text('One')),
      node('numbered_list_item', text('Two')),
      node('toggle', text('Toggle me'), [p('Inside')]),
      node('callout', {
        ...text('Tip: read this', [
          { text: 'Tip: ' },
          { text: 'read', italic: true },
          { text: ' this' },
        ]),
        icon: 'emoji:💡',
      }),
      node('quote', text('A quote')),
      node('divider', {}),
      node('code', { text: 'let x = 1;', language: 'javascript' }),
      node('code', { text: 'plain', language: 'plain' }),
      node('image', { url: 'https://images.test/x.png', alt: '', caption: 'External' }),
      node('link_to_page', {
        href: 'Getting%20Started%200123456789abcdef0123456789abcdef/Sub%20page%20fedcba9876543210fedcba9876543210.html',
        title: 'Sub page',
      }),
      node('bookmark', { url: 'https://nilo.test/', title: 'Nilo', description: 'Docs' }),
      p('report.pdf'),
      node('equation', { latex: 'x^2' }),
      p('Inline y math'),
      node('table', { rows: 1, cols: 2, withHeader: false }, [
        node('table_row', {}, [node('table_cell', text('a')), node('table_cell', text('b'))]),
      ]),
      node('columns', { columnCount: 2 }, [
        node('column', {}, [p('L')]),
        node('column', {}, [p('R')]),
      ]),
    ]);
  });

  it('reads a Notion database: a full-page one, and one inline in a page', () => {
    const table = `<table class="collection-content"><thead><tr><th><span class="icon property-icon"><svg><path d="M0"/></svg></span>Name</th><th>Status</th><th>Tags</th><th>Done</th><th>Due</th></tr></thead><tbody><tr id="r1"><td class="cell-title"><a href="Tasks%20fedcba9876543210fedcba9876543210/Write%2011111111111111111111111111111111.html">Write</a></td><td><span class="status-value"><div class="status-dot"></div>Todo</span></td><td><span class="selected-value select-value-color-blue">a</span><span class="selected-value">b</span></td><td><div class="checkbox checkbox-on"></div></td><td><time>@October 1, 2026</time></td></tr></tbody></table>`;
    const full = readHtmlPage(
      `<title>Tasks</title><article class="page sans"><header><h1 class="page-title">Tasks</h1></header><div class="page-body">${table}<br/><br/></div></article>`,
    );
    expect(full).toEqual({
      title: 'Tasks',
      blocks: [],
      isDatabase: true,
      databases: [
        {
          name: null,
          table: [
            ['Name', 'Status', 'Tags', 'Done', 'Due'],
            ['Write', 'Todo', 'a, b', 'Yes', 'October 1, 2026'],
          ],
          rowHrefs: [
            'Tasks%20fedcba9876543210fedcba9876543210/Write%2011111111111111111111111111111111.html',
          ],
        },
      ],
    });
    const inline = readHtmlPage(
      `<title>Team</title><article class="page sans"><div class="page-body"><p>Our tasks:</p><div class="collection-content"><h4 class="collection-title">Tasks</h4>${table}</div></div></article>`,
    );
    expect(inline.isDatabase).toBe(false);
    expect(inline.blocks).toEqual([p('Our tasks:')]);
    expect(inline.databases.map((d) => d.name)).toEqual(['Tasks']);
  });
});

describe('round trip with blocksToHtml', () => {
  const rich: Segment[] = [
    { text: 'Some ' },
    { text: 'bold', bold: true },
    { text: ' and ' },
    { text: 'a link', italic: true, link: 'https://x.test/a?b=1&c="2"' },
    { text: ' ' },
    { text: '<code>', code: true },
    { text: ' ' },
    { text: 'u', underline: true },
    { text: 's', strike: true },
    { text: '\nnext & line' },
  ];
  const blocks: BlockNode[] = [
    node('paragraph', text('', rich)),
    node('heading_1', text('Heading one')),
    node('heading_2', text('Heading two')),
    node('heading_3', text('Heading three')),
    node('bulleted_list_item', text('Bullet'), [
      node('bulleted_list_item', text('Nested')),
      node('numbered_list_item', text('Nested number')),
      node('paragraph', text('Continued')),
    ]),
    node('todo', { ...text('Open'), checked: false }),
    node('todo', { ...text('Done'), checked: true }, [
      node('todo', { ...text('Sub'), checked: false }),
    ]),
    node('toggle', text('Toggle'), [p('Hidden')]),
    node('numbered_list_item', text('First')),
    node('numbered_list_item', text('Second')),
    node('quote', text('Quoted\nlines')),
    node('callout', { ...text('Hot'), icon: 'emoji:🔥' }),
    node('callout', { ...text('Plain'), icon: 'icon:lightbulb' }, [p('Inside')]),
    node('code', { text: 'if (a < b) {\n  return "x";\n}', language: 'ts' }),
    node('code', { text: '  indented\n\n  blank above', language: 'plain' }),
    node('divider', {}),
    node('image', { url: 'https://img.test/a.png?x=1&y=2', alt: 'Alt "text"' }),
    node('equation', { latex: '\\frac{a}{b} < c' }),
    node('table', { rows: 2, cols: 2, withHeader: true }, [
      node('table_row', {}, [node('table_cell', text('H1')), node('table_cell', text('H2'))]),
      node('table_row', {}, [
        node('table_cell', text('', [{ text: 'x', bold: true }])),
        node('table_cell', text('')),
      ]),
    ]),
    node('table', { rows: 1, cols: 1, withHeader: false }, [
      node('table_row', {}, [node('table_cell', text('only'))]),
    ]),
    node('columns', { columnCount: 2 }, [
      node('column', {}, [p('Left'), node('bulleted_list_item', text('L1'))]),
      node('column', {}, [p('Right')]),
    ]),
  ];

  it('reads back what blocksToHtml writes, title and all', () => {
    expect(readHtmlPage(blocksToHtml(blocks, 'A <page> & "more"'))).toEqual({
      title: 'A <page> & "more"',
      blocks,
      databases: [],
      isDatabase: false,
    });
  });

  it('reads back the body alone', () => {
    expect(htmlToBlocks(blocksToHtmlBody(blocks))).toEqual(blocks);
  });

  it('lands a Markdown document as markdownToBlocks does', () => {
    const md = [
      'Intro with **bold**, _italic_, ~~strike~~, `code` and [a link](https://x.test).',
      '',
      '## Section',
      '',
      '- one',
      '    - nested',
      '- [x] done',
      '- [ ] open',
      '',
      '1. first',
      '2. second',
      '',
      '> quoted',
      '',
      '> 💡 call out',
      '',
      '```python',
      'print("hi")',
      '```',
      '',
      '---',
      '',
      '![alt](https://img.test/x.png)',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '$$',
      'x^2',
      '$$',
    ].join('\n');
    const fromMarkdown = markdownToBlocks(md);
    expect(htmlToBlocks(blocksToHtmlBody(fromMarkdown))).toEqual(fromMarkdown);
  });

  it('degrades attachments and bookmarks to the link blocksToHtml writes', () => {
    expect(
      htmlToBlocks(
        blocksToHtmlBody([node('bookmark', { url: 'https://nilo.test/', title: 'Nilo' })]),
      ),
    ).toEqual([node('paragraph', text('', [{ text: 'Nilo', link: 'https://nilo.test/' }]))]);
  });
});
