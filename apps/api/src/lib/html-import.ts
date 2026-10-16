/**
 * HTML → blocks, for importing `.html` files and Notion's HTML export.
 *
 * The blocks have the shapes `markdownToBlocks` gives (`{ text, segments }`
 * for text, the same list, code, callout and table contents), so a page
 * imported as HTML lands as it would as Markdown, and what `blocksToHtml`
 * writes reads back as the blocks it was written from.
 *
 * The document is parsed by parse5, the HTML standard's algorithm, so
 * unclosed tags and stray markup end up where a browser puts them. Text
 * collapses whitespace as a browser renders it; `<br>` is a line break.
 * Scripts, styles, comments and form controls are dropped; an element with
 * no block meaning reads as its text; links keep only targets `SAFE_LINK`
 * accepts and images only `http(s)` sources.
 *
 * Notion's export is read as Notion writes it: the page body without its
 * header, to-dos as `div.checkbox`, callouts, toggles, columns, bookmarks,
 * equations, links to other exported pages, and databases as
 * `table.collection-content`, which are returned as tables rather than
 * blocks so the import can create them as databases.
 */
import {
  type BlockContent,
  type BlockNode,
  type BlockType,
  mergeSegments,
  SAFE_LINK,
  type Segment,
} from '@oxy.so/nilo-contracts';
import { type DefaultTreeAdapterMap, defaultTreeAdapter, parse, type TreeAdapter } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type TextNode = DefaultTreeAdapterMap['textNode'];
type ChildNode = DefaultTreeAdapterMap['childNode'];

/**
 * How deep elements may nest. The standard parse scans the open elements on
 * most tags, so its cost grows with the square of the depth; past this a
 * document is refused rather than parsed. No real page nests this deep.
 */
export const MAX_HTML_DEPTH = 256;

/** A document nested deeper than `MAX_HTML_DEPTH`. */
export class HtmlTooDeepError extends Error {
  constructor() {
    super(`HTML nests deeper than ${MAX_HTML_DEPTH} elements`);
    this.name = 'HtmlTooDeepError';
  }
}

/** A Notion database in an exported page: its cells and its rows' own pages. */
export interface HtmlDatabase {
  /** The database's title shown above it, when it is inline in a page. */
  name: string | null;
  /** The header row, then one row per record, as text. */
  table: string[][];
  /** Each record's link to its exported page, as written (relative to the document). */
  rowHrefs: string[];
}

/** An HTML document read as a page. */
export interface HtmlPage {
  /** `<title>`, else a leading `<h1>`, which is then not among `blocks`. */
  title: string | null;
  blocks: BlockNode[];
  databases: HtmlDatabase[];
  /** The page is one database and nothing else: Notion's export of a full-page database. */
  isDatabase: boolean;
}

// ───────────────────────────── parsing ─────────────────────────────

function parseDocument(html: string): DefaultTreeAdapterMap['document'] {
  const depth = new WeakMap<Node, number>();
  const place = (parent: Node, node: Node) => {
    const level = (depth.get(parent) ?? 0) + 1;
    if (level > MAX_HTML_DEPTH) throw new HtmlTooDeepError();
    depth.set(node, level);
  };
  const treeAdapter: TreeAdapter<DefaultTreeAdapterMap> = {
    ...defaultTreeAdapter,
    appendChild(parent, node) {
      place(parent, node);
      defaultTreeAdapter.appendChild(parent, node);
    },
    insertBefore(parent, node, reference) {
      place(parent, node);
      defaultTreeAdapter.insertBefore(parent, node, reference);
    },
  };
  return parse(html, { treeAdapter });
}

const isElement = (node: Node): node is Element => 'tagName' in node;
const isText = (node: Node): node is TextNode => node.nodeName === '#text';
const attr = (el: Element, name: string) => el.attrs.find((a) => a.name === name)?.value;
const hasClass = (el: Element, name: string) =>
  (attr(el, 'class') ?? '').split(/\s+/).includes(name);
const isBlank = (node: Node) => isText(node) && !/[^ \t\n\r\f]/.test(node.value);

/** The first element under `root` (itself included), depth first, that `test` accepts. */
function find(root: Element, test: (el: Element) => boolean): Element | null {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as Node;
    if (!isElement(node)) continue;
    if (test(node)) return node;
    for (let i = node.childNodes.length - 1; i >= 0; i -= 1)
      stack.push(node.childNodes[i] as ChildNode);
  }
  return null;
}

/** Every element under `root` that `test` accepts, in document order. */
function findAll(root: Element, test: (el: Element) => boolean): Element[] {
  const found: Element[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as Node;
    if (!isElement(node)) continue;
    if (test(node) && node !== root) found.push(node);
    for (let i = node.childNodes.length - 1; i >= 0; i -= 1)
      stack.push(node.childNodes[i] as ChildNode);
  }
  return found;
}

/** The text of an element as written, `<br>` as a line break, dropped elements left out. */
function rawText(root: Element): string {
  let out = '';
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as Node;
    if (isText(node)) out += node.value;
    else if (isElement(node)) {
      if (node.tagName === 'br') out += '\n';
      else if (node === root || !DROPPED.has(node.tagName))
        for (let i = node.childNodes.length - 1; i >= 0; i -= 1)
          stack.push(node.childNodes[i] as ChildNode);
    }
  }
  return out;
}

const isHttp = (url: string | undefined): url is string => !!url && /^https?:\/\//i.test(url);

// ───────────────────────────── inline ─────────────────────────────

/** Elements with nothing to read: their content is never text of the page. */
const DROPPED = new Set([
  'head',
  'title',
  'meta',
  'link',
  'base',
  'script',
  'style',
  'template',
  'noscript',
  'noframes',
  'noembed',
  'svg',
  'canvas',
  'object',
  'embed',
  'input',
  'select',
  'option',
  'datalist',
  'textarea',
  'map',
  'area',
  'source',
  'track',
  'param',
  'frameset',
  'frame',
]);

/** Elements that end the paragraph before them: their content is read as blocks. */
const BLOCKS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'caption',
  'center',
  'dd',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'html',
  'iframe',
  'img',
  'legend',
  'li',
  'main',
  'menu',
  'nav',
  'ol',
  'p',
  'pre',
  'search',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
  'video',
  'audio',
]);

type Marks = Omit<Segment, 'text'>;

const TAG_MARKS: Record<string, keyof Marks> = {
  b: 'bold',
  strong: 'bold',
  i: 'italic',
  em: 'italic',
  cite: 'italic',
  var: 'italic',
  dfn: 'italic',
  u: 'underline',
  ins: 'underline',
  s: 'strike',
  strike: 'strike',
  del: 'strike',
  code: 'code',
  kbd: 'code',
  samp: 'code',
  tt: 'code',
};

interface Context {
  marks: Marks;
  /** Whitespace kept as written (`<pre>`, `white-space: pre…`). */
  pre: boolean;
  /** Databases met while reading, for the page to return. */
  databases: HtmlDatabase[];
}

/** A run of text not yet settled: `pre` runs keep their whitespace. */
interface Run extends Segment {
  pre?: boolean;
}

/** What reading a sequence of nodes produces: blocks, and the paragraph still open after them. */
interface Sink {
  blocks: BlockNode[];
  runs: Run[];
}

/** `style="…"` → its declarations, names lower-cased. */
function declarations(style: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (style ?? '').split(';')) {
    const colon = part.indexOf(':');
    if (colon > 0)
      out.set(
        part.slice(0, colon).trim().toLowerCase(),
        part
          .slice(colon + 1)
          .trim()
          .toLowerCase(),
      );
  }
  return out;
}

/** The context inside `el`: its tag's mark, its link, and what its inline style says. */
function within(el: Element, ctx: Context): Context {
  const marks: Marks = { ...ctx.marks };
  let pre = ctx.pre;
  const mark = TAG_MARKS[el.tagName];
  if (mark) (marks as Record<string, boolean>)[mark] = true;
  if (el.tagName === 'a') {
    const href = attr(el, 'href')?.trim();
    if (href && SAFE_LINK.test(href)) marks.link = href;
  }
  const style = declarations(attr(el, 'style'));
  const weight = style.get('font-weight');
  if (weight && /^(bold|bolder|[6-9]00)$/.test(weight)) marks.bold = true;
  else if (weight && /^(normal|lighter|[1-4]00)$/.test(weight)) delete marks.bold;
  const fontStyle = style.get('font-style');
  if (fontStyle === 'italic' || fontStyle === 'oblique') marks.italic = true;
  else if (fontStyle === 'normal') delete marks.italic;
  const decoration = style.get('text-decoration-line') ?? style.get('text-decoration') ?? '';
  if (decoration.includes('underline')) marks.underline = true;
  if (decoration.includes('line-through')) marks.strike = true;
  // Notion underlines with a bottom border.
  if (el.tagName === 'span' && style.get('border-bottom')?.includes('solid'))
    marks.underline = true;
  const whiteSpace = style.get('white-space');
  if (whiteSpace) pre = /^(pre|pre-wrap|pre-line|break-spaces)$/.test(whiteSpace);
  return { ...ctx, marks, pre };
}

/**
 * Runs → segments, whitespace as a browser renders it: runs of spaces are
 * one space, none at the start or end of a line, and a last line break
 * opens no empty line. A collapsed space stays in the run it was typed in.
 */
function settle(runs: readonly Run[]): Segment[] {
  const out: Segment[] = runs.map(({ pre: _pre, ...segment }) => ({ ...segment, text: '' }));
  const texts: string[][] = runs.map(() => []);
  let lineStart = true;
  let space: number | null = null;
  runs.forEach((run, i) => {
    const text = texts[i] as string[];
    if (run.pre) {
      if (!run.text) return;
      if (space !== null) (texts[space] as string[]).push(' ');
      space = null;
      text.push(run.text);
      lineStart = run.text.endsWith('\n');
      return;
    }
    for (const ch of run.text) {
      if (ch === ' ') {
        if (!lineStart && space === null) space = i;
      } else if (ch === '\n') {
        space = null;
        text.push('\n');
        lineStart = true;
      } else {
        if (space !== null) (texts[space] as string[]).push(' ');
        space = null;
        text.push(ch);
        lineStart = false;
      }
    }
  });
  out.forEach((segment, i) => {
    segment.text = (texts[i] as string[]).join('');
  });
  const merged = mergeSegments(out);
  const last = merged[merged.length - 1];
  if (last?.text.endsWith('\n')) {
    last.text = last.text.slice(0, -1);
    if (!last.text) merged.pop();
  }
  return merged;
}

const plain = (segments: readonly Segment[]) => segments.map((s) => s.text).join('');

/** Text content as `markdownToBlocks` writes it: the plain text and its segments. */
const textContent = (segments: Segment[]): BlockContent => ({ text: plain(segments), segments });

const node = (type: BlockType, content: BlockContent, children: BlockNode[] = []): BlockNode => ({
  type,
  content,
  children,
});

/** Closes the open paragraph: a paragraph block, unless it holds only whitespace. */
function flush(sink: Sink): void {
  if (sink.runs.length === 0) return;
  const segments = settle(sink.runs);
  sink.runs = [];
  if (/\S/.test(plain(segments))) sink.blocks.push(node('paragraph', textContent(segments)));
}

/** Nodes → blocks. */
function collect(nodes: readonly ChildNode[], ctx: Context): BlockNode[] {
  const sink: Sink = { blocks: [], runs: [] };
  flow(nodes, ctx, sink);
  flush(sink);
  return sink.blocks;
}

/**
 * A text block's own text and what follows it: the first block when it is a
 * paragraph (`<li><p>Item</p>…`), and the rest.
 */
function lead(blocks: BlockNode[]): [Segment[], BlockNode[]] {
  const [first, ...rest] = blocks;
  if (first?.type === 'paragraph' && first.children.length === 0)
    return [first.content.segments as Segment[], rest];
  return [[], blocks];
}

/** Everything under the nodes as one run of segments, blocks one line each. */
function flatSegments(nodes: readonly ChildNode[], ctx: Context): Segment[] {
  const lines: Segment[][] = [];
  const walk = (blocks: readonly BlockNode[]) => {
    for (const block of blocks) {
      const segments = block.content.segments;
      if (Array.isArray(segments)) lines.push(segments as Segment[]);
      else if (typeof block.content.text === 'string') lines.push([{ text: block.content.text }]);
      walk(block.children);
    }
  };
  walk(collect(nodes, ctx));
  return mergeSegments(lines.flatMap((line, i) => (i === 0 ? line : [{ text: '\n' }, ...line])));
}

const plainText = (el: Element, ctx: Context) =>
  plain(flatSegments(el.childNodes, { ...ctx, marks: {} })).trim();

function flow(nodes: readonly ChildNode[], ctx: Context, sink: Sink): void {
  for (const child of nodes) {
    if (isText(child)) {
      const text = ctx.pre ? child.value : child.value.replace(/[ \t\n\r\f]+/g, ' ');
      sink.runs.push({ ...ctx.marks, text, ...(ctx.pre && { pre: true }) });
    } else if (isElement(child)) element(child, ctx, sink);
  }
}

// ───────────────────────────── blocks ─────────────────────────────

function element(el: Element, outer: Context, sink: Sink): void {
  const tag = el.tagName;
  if (DROPPED.has(tag)) return;
  if (tag === 'br') {
    sink.runs.push({ ...outer.marks, text: '\n' });
    return;
  }
  // KaTeX (Notion's inline equations) reads as its TeX source.
  if (hasClass(el, 'katex')) {
    const tex = find(el, (e) => e.tagName === 'annotation');
    if (tex) sink.runs.push({ ...outer.marks, text: rawText(tex).trim() });
    return;
  }
  const ctx = within(el, outer);
  if (!BLOCKS.has(tag)) {
    flow(el.childNodes, ctx, sink);
    return;
  }
  flush(sink);
  const out = sink.blocks;
  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Math.min(Number(tag[1]), 3);
      const [segments, rest] = lead(collect(el.childNodes, ctx));
      out.push(node(`heading_${level}` as BlockType, textContent(segments)), ...rest);
      return;
    }
    case 'ul':
    case 'ol':
    case 'menu':
    case 'dir':
      list(el, tag === 'ol', ctx, sink);
      return;
    case 'li':
      out.push(listItem(el, false, ctx));
      return;
    case 'details':
      out.push(toggle(el, ctx));
      return;
    case 'blockquote': {
      const [segments, rest] = lead(collect(el.childNodes, ctx));
      out.push(node('quote', textContent(segments), rest));
      return;
    }
    case 'pre':
      out.push(codeBlock(el));
      return;
    case 'hr':
      out.push(node('divider', {}));
      return;
    case 'img': {
      const image = imageBlock(el);
      if (image) out.push(image);
      return;
    }
    case 'video':
    case 'audio': {
      const src = (
        attr(el, 'src') ?? attr(find(el, (e) => e.tagName === 'source') ?? el, 'src')
      )?.trim();
      if (isHttp(src)) out.push(node(tag, { url: src }));
      return;
    }
    case 'iframe': {
      const src = attr(el, 'src')?.trim();
      if (isHttp(src)) out.push(node('embed', { url: src }));
      return;
    }
    case 'table':
      if (hasClass(el, 'collection-content')) ctx.databases.push(database(el, null, ctx));
      else out.push(...table(el, ctx));
      return;
  }
  if (hasClass(el, 'callout')) {
    out.push(callout(el, ctx));
    return;
  }
  if (hasClass(el, 'equation')) {
    const tex = find(el, (e) => e.tagName === 'annotation');
    out.push(node('equation', { latex: rawText(tex ?? el).trim() }));
    return;
  }
  if (hasClass(el, 'column-list') || hasClass(el, 'columns')) {
    out.push(...columns(el, ctx));
    return;
  }
  if (hasClass(el, 'collection-content')) {
    const tableEl = find(el, (e) => e.tagName === 'table');
    const title = find(el, (e) => hasClass(e, 'collection-title'));
    if (tableEl)
      ctx.databases.push(database(tableEl, title ? plainText(title, ctx) || null : null, ctx));
    return;
  }
  if (hasClass(el, 'checkbox')) return;
  if (tag === 'figure') {
    const figure = figureBlocks(el, ctx);
    if (figure) {
      out.push(...figure);
      return;
    }
  }
  // Any other block: its content in order, then a paragraph break.
  flow(el.childNodes, ctx, sink);
  flush(sink);
}

function list(el: Element, ordered: boolean, ctx: Context, sink: Sink): void {
  for (const child of el.childNodes) {
    if (isElement(child) && child.tagName === 'li') {
      flush(sink);
      sink.blocks.push(listItem(child, ordered, within(child, ctx)));
    } else if (isElement(child) && (child.tagName === 'ul' || child.tagName === 'ol')) {
      // A list straight inside a list nests under the item before it, as a browser shows it.
      flush(sink);
      const previous = sink.blocks[sink.blocks.length - 1];
      const nested: Sink = { blocks: [], runs: [] };
      list(child, child.tagName === 'ol', within(child, ctx), nested);
      flush(nested);
      if (previous && LIST_ITEMS.has(previous.type)) previous.children.push(...nested.blocks);
      else sink.blocks.push(...nested.blocks);
    } else flow([child], ctx, sink);
  }
  flush(sink);
}

const LIST_ITEMS = new Set<string>(['bulleted_list_item', 'numbered_list_item', 'todo', 'toggle']);

const significant = (nodes: readonly ChildNode[]) =>
  nodes.filter((n) => !isBlank(n) && n.nodeName !== '#comment');

function listItem(li: Element, ordered: boolean, ctx: Context): BlockNode {
  let nodes: ChildNode[] = li.childNodes;
  const [first] = significant(nodes);
  if (first && isElement(first) && first.tagName === 'details') {
    const item = toggle(first, ctx);
    item.children.push(...collect(nodes.slice(nodes.indexOf(first) + 1), ctx));
    return item;
  }
  // `<input type="checkbox">` (HTML, GitHub) or Notion's `div.checkbox` makes a to-do.
  let checked: boolean | null = null;
  if (
    first &&
    isElement(first) &&
    ((first.tagName === 'input' && attr(first, 'type')?.toLowerCase() === 'checkbox') ||
      hasClass(first, 'checkbox'))
  ) {
    checked = attr(first, 'checked') !== undefined || hasClass(first, 'checkbox-on');
    nodes = nodes.filter((n) => n !== first);
  }
  const [segments, rest] = lead(collect(nodes, ctx));
  if (checked !== null) return node('todo', { ...textContent(segments), checked }, rest);
  return node(ordered ? 'numbered_list_item' : 'bulleted_list_item', textContent(segments), rest);
}

/** `<details><summary>…</summary>…</details>` → a toggle; closed, it says so. */
function toggle(details: Element, ctx: Context): BlockNode {
  const summary = details.childNodes.find(
    (n): n is Element => isElement(n) && n.tagName === 'summary',
  );
  const [segments, extra] = summary
    ? lead(collect(summary.childNodes, within(summary, ctx)))
    : [[], []];
  const children = [
    ...extra,
    ...collect(
      details.childNodes.filter((n) => n !== summary),
      ctx,
    ),
  ];
  const closed = attr(details, 'open') === undefined;
  return node('toggle', { ...textContent(segments), ...(closed && { expanded: false }) }, children);
}

/** `<pre>` → a code block, its language from a `language-…` class. */
function codeBlock(pre: Element): BlockNode {
  const code = significant(pre.childNodes).find(
    (n): n is Element => isElement(n) && n.tagName === 'code',
  );
  const language = [code, pre]
    .flatMap((el) => (el ? (attr(el, 'class') ?? '').split(/\s+/) : []))
    .find((name) => /^lang(uage)?-./i.test(name))
    ?.replace(/^lang(uage)?-/i, '')
    .toLowerCase();
  const text = rawText(pre).replace(/\n$/, '');
  return node('code', { text, language: language || 'plain' });
}

function imageBlock(img: Element, caption?: string): BlockNode | null {
  const url = attr(img, 'src')?.trim();
  if (!isHttp(url)) return null;
  return node('image', { url, alt: attr(img, 'alt') ?? '', ...(caption && { caption }) });
}

/** `<aside class="callout">` (Nilo's export) or Notion's `figure.callout`: icon, then text. */
function callout(el: Element, ctx: Context): BlockNode {
  let iconEl: Element | null = null;
  let iconHolder: ChildNode | null = null;
  const [first] = significant(el.childNodes);
  if (first && isElement(first)) {
    if (hasClass(first, 'icon')) iconEl = first;
    else {
      const inner = significant(first.childNodes);
      const only = inner.length === 1 ? inner[0] : undefined;
      if (only && isElement(only) && hasClass(only, 'icon')) iconEl = only;
    }
    if (iconEl) iconHolder = first;
  }
  const emoji = iconEl && iconEl.tagName !== 'img' ? rawText(iconEl).trim() : '';
  const [segments, rest] = lead(
    collect(
      el.childNodes.filter((n) => n !== iconHolder),
      ctx,
    ),
  );
  return node(
    'callout',
    { ...textContent(segments), icon: emoji ? `emoji:${emoji}` : 'icon:lightbulb' },
    rest,
  );
}

function table(el: Element, ctx: Context): BlockNode[] {
  const rows: { cells: Element[]; head: boolean }[] = [];
  const before: BlockNode[] = [];
  for (const child of el.childNodes) {
    if (!isElement(child)) continue;
    if (child.tagName === 'caption') before.push(...collect(child.childNodes, ctx));
    const head = child.tagName === 'thead';
    const trs =
      child.tagName === 'tr'
        ? [child]
        : child.childNodes.filter((n): n is Element => isElement(n) && n.tagName === 'tr');
    for (const tr of trs)
      rows.push({
        cells: tr.childNodes.filter(
          (n): n is Element => isElement(n) && (n.tagName === 'td' || n.tagName === 'th'),
        ),
        head,
      });
  }
  const filled = rows.filter((row) => row.cells.length > 0);
  if (filled.length === 0) return before;
  const cols = Math.max(...filled.map((row) => row.cells.length));
  const [first] = filled;
  const withHeader = !!first && (first.head || first.cells.every((c) => c.tagName === 'th'));
  return [
    ...before,
    node(
      'table',
      { rows: filled.length, cols, withHeader },
      filled.map((row) =>
        node(
          'table_row',
          {},
          Array.from({ length: cols }, (_, c) => {
            const cell = row.cells[c];
            return node(
              'table_cell',
              textContent(cell ? flatSegments(cell.childNodes, within(cell, ctx)) : []),
            );
          }),
        ),
      ),
    ),
  ];
}

/** A Notion database's table: header names, each record's values as text, and its links. */
function database(el: Element, name: string | null, ctx: Context): HtmlDatabase {
  const rows = findAll(el, (e) => e.tagName === 'tr');
  const cellsOf = (tr: Element) =>
    tr.childNodes.filter(
      (n): n is Element => isElement(n) && (n.tagName === 'td' || n.tagName === 'th'),
    );
  const [header, ...records] = rows;
  const table: string[][] = [];
  const rowHrefs: string[] = [];
  if (header) table.push(cellsOf(header).map((cell) => plainText(cell, ctx)));
  for (const tr of records) {
    const cells = cellsOf(tr);
    table.push(cells.map((cell) => cellValue(cell, ctx)));
    const link = cells[0] && find(cells[0], (e) => e.tagName === 'a' && !!attr(e, 'href'));
    if (link) rowHrefs.push(attr(link, 'href') as string);
  }
  return { name, table, rowHrefs };
}

/** A database cell as Notion's CSV writes it: checkboxes as Yes/No, several options comma-separated. */
function cellValue(cell: Element, ctx: Context): string {
  const box = find(cell, (e) => hasClass(e, 'checkbox'));
  if (box) return hasClass(box, 'checkbox-on') ? 'Yes' : 'No';
  const options = findAll(cell, (e) => hasClass(e, 'selected-value'));
  if (options.length > 0) return options.map((o) => plainText(o, ctx)).join(', ');
  const text = plainText(cell, ctx);
  // Notion writes dates as `@October 1, 2026`.
  return find(cell, (e) => e.tagName === 'time') ? text.replace(/^@/, '') : text;
}

/** Notion's `div.column-list` or Nilo's `div.columns`: two to four columns, else their blocks in order. */
function columns(el: Element, ctx: Context): BlockNode[] {
  const cols = el.childNodes
    .filter((n): n is Element => isElement(n) && hasClass(n, 'column'))
    .map((col) => collect(col.childNodes, within(col, ctx)));
  if (cols.length >= 2 && cols.length <= 4)
    return [
      node(
        'columns',
        { columnCount: cols.length },
        cols.map((blocks) => node('column', {}, blocks)),
      ),
    ];
  return cols.length > 0 ? cols.flat() : collect(el.childNodes, ctx);
}

/**
 * Notion's figures: a link to another exported page (`link_to_page` with
 * the link's `href` and `title`, for the import to resolve), a bookmark, an
 * embedded source, or an image with its caption. Null for any other figure.
 */
function figureBlocks(el: Element, ctx: Context): BlockNode[] | null {
  const link = find(el, (e) => e.tagName === 'a' && !!attr(e, 'href'));
  const href = link ? (attr(link, 'href') as string).trim() : '';
  const label = (from: Element) =>
    plain(
      flatSegments(
        from.childNodes.filter((n) => !(isElement(n) && hasClass(n, 'icon'))),
        { ...ctx, marks: {} },
      ),
    ).trim();
  if (hasClass(el, 'link-to-page') && link) {
    const title = label(link);
    if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('/') && !href.startsWith('#'))
      return [node('link_to_page', { href, title })];
    return [linkParagraph(title || href, href)];
  }
  // Notion classes the link (`a.bookmark.source`), Nilo's own markup the figure.
  if (find(el, (e) => hasClass(e, 'bookmark')) && link && isHttp(href)) {
    const title = find(el, (e) => hasClass(e, 'bookmark-title'));
    const description = find(el, (e) => hasClass(e, 'bookmark-description'));
    const titleText = title ? plainText(title, ctx) : '';
    const descriptionText = description ? plainText(description, ctx) : '';
    return [
      node('bookmark', {
        url: href,
        ...(titleText && { title: titleText }),
        ...(descriptionText && { description: descriptionText }),
      }),
    ];
  }
  const source = find(el, (e) => hasClass(e, 'source'));
  if (source && link) {
    const text = label(link);
    if (isHttp(href))
      return [node('bookmark', { url: href, ...(text && text !== href && { title: text }) })];
    return text ? [node('paragraph', textContent([{ text }]))] : [];
  }
  const img = find(el, (e) => e.tagName === 'img');
  if (img) {
    const captionEl = find(el, (e) => e.tagName === 'figcaption');
    const caption = captionEl ? plainText(captionEl, ctx) : '';
    const image = imageBlock(img, caption);
    if (image) return [image];
    return caption ? [node('paragraph', textContent([{ text: caption }]))] : [];
  }
  return null;
}

function linkParagraph(text: string, href: string): BlockNode {
  const segments = SAFE_LINK.test(href) ? [{ text, link: href }] : [{ text }];
  return node('paragraph', textContent(segments));
}

// ───────────────────────────── documents ─────────────────────────────

const newContext = (): Context => ({ marks: {}, pre: false, databases: [] });

function bodyOf(document: DefaultTreeAdapterMap['document']): Element | null {
  const html = document.childNodes.find((n): n is Element => isElement(n) && n.tagName === 'html');
  return html?.childNodes.find((n): n is Element => isElement(n) && n.tagName === 'body') ?? null;
}

/** HTML → block trees, every element read (no title taken out). Throws `HtmlTooDeepError`. */
export function htmlToBlocks(html: string): BlockNode[] {
  const body = bodyOf(parseDocument(html));
  return body ? collect(body.childNodes, newContext()) : [];
}

/**
 * An HTML document as a page: its title, blocks and databases. A Notion
 * export is read from its page body (`div.page-body`); its header holds the
 * title, icon and properties, which are not blocks. Throws `HtmlTooDeepError`.
 */
export function readHtmlPage(html: string): HtmlPage {
  const document = parseDocument(html);
  const htmlEl = document.childNodes.find(
    (n): n is Element => isElement(n) && n.tagName === 'html',
  );
  const body = bodyOf(document);
  const ctx = newContext();
  const titleEl = htmlEl ? find(htmlEl, (e) => e.tagName === 'title') : null;
  let title: string | null = titleEl ? rawText(titleEl).replace(/\s+/g, ' ').trim() || null : null;
  if (!body) return { title, blocks: [], databases: [], isDatabase: false };

  const notionBody = find(body, (e) => hasClass(e, 'page-body'));
  const root = notionBody ?? body;
  if (notionBody && !title) {
    const heading = find(body, (e) => hasClass(e, 'page-title'));
    title = heading ? plainText(heading, ctx) || null : null;
  }
  const content = significant(root.childNodes).filter((n) => !(isElement(n) && n.tagName === 'br'));
  const [only] = content;
  const isDatabase =
    content.length === 1 && !!only && isElement(only) && hasClass(only, 'collection-content');

  let blocks = collect(root.childNodes, ctx);
  // A leading level-one heading is the title, as `markdownTitle` takes `# Title`.
  const [first] = blocks;
  if (first?.type === 'heading_1') {
    const text = plain(first.content.segments as Segment[]).trim();
    if (!title && text) {
      title = text;
      blocks = blocks.slice(1);
    } else if (text === title) blocks = blocks.slice(1);
  }
  return { title, blocks, databases: ctx.databases, isDatabase };
}
