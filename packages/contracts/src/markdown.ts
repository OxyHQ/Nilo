/**
 * Markdown and HTML for blocks: import (Markdown → blocks) and export
 * (blocks → Markdown, blocks → HTML).
 *
 * Inline formatting maps to segments both ways: **bold**, _italic_,
 * `code`, ~~strike~~ and [links](https://…) (only links `SAFE_LINK` accepts;
 * others stay text). Block structure covers what a Notion export or a
 * hand-written note uses: headings, paragraphs, bulleted / numbered / to-do
 * lists nested by indentation, quotes, callouts, fenced code, dividers,
 * images, tables and equations. HTML output escapes every piece of text.
 */
import { type BlockContent, type BlockType, SAFE_LINK } from './blocks';

/** A run of text with its marks, as block content stores it (`content.segments`). */
export interface Segment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: string;
}

/** A block with its children, independent of ids and orders. */
export interface BlockNode {
  type: BlockType;
  content: BlockContent;
  children: BlockNode[];
}

/** A stored block, as the API lists them. */
export interface FlatBlock {
  id: string;
  parentBlockId: string | null;
  type: string;
  content: BlockContent;
  order: number;
}

// ───────────────────────────── inline ─────────────────────────────

type Mark = 'bold' | 'italic' | 'strike' | 'code';

const plainText = (segments: readonly Segment[]) => segments.map((s) => s.text).join('');

function sameMarks(a: Segment, b: Segment): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline &&
    !!a.strike === !!b.strike &&
    !!a.code === !!b.code &&
    a.link === b.link
  );
}

/** Adjacent runs with the same marks become one; empty runs go. */
export function mergeSegments(segments: readonly Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const segment of segments) {
    if (!segment.text) continue;
    const last = out[out.length - 1];
    if (last && sameMarks(last, segment)) last.text += segment.text;
    else out.push({ ...segment });
  }
  return out;
}

const withMarks = (text: string, marks: ReadonlySet<Mark>, link?: string): Segment => ({
  text,
  ...(marks.has('bold') && { bold: true }),
  ...(marks.has('italic') && { italic: true }),
  ...(marks.has('strike') && { strike: true }),
  ...(marks.has('code') && { code: true }),
  ...(link && { link }),
});

const DELIMITERS: readonly [string, Mark][] = [
  ['**', 'bold'],
  ['__', 'bold'],
  ['~~', 'strike'],
  ['*', 'italic'],
  ['_', 'italic'],
];

/**
 * Where `delimiter` next occurs in `text` from `from`, outside escapes and
 * code spans (a `_` inside `` `x_y` `` closes nothing). -1 when it does not.
 */
function findClosing(text: string, from: number, delimiter: string): number {
  for (let i = from; i < text.length; ) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === '`') {
      const ticks = /^`+/.exec(text.slice(i))?.[0] ?? '`';
      const end = text.indexOf(ticks, i + ticks.length);
      if (end > 0) {
        i = end + ticks.length;
        continue;
      }
    }
    if (text.startsWith(delimiter, i)) return i;
    i += 1;
  }
  return -1;
}

/** Markdown inline text → segments. */
export function parseInline(source: string): Segment[] {
  const out: Segment[] = [];
  const parse = (text: string, marks: Set<Mark>, link?: string) => {
    let buffer = '';
    const flush = () => {
      if (buffer) out.push(withMarks(buffer, marks, link));
      buffer = '';
    };
    let i = 0;
    while (i < text.length) {
      const ch = text[i] as string;
      if (ch === '\\' && i + 1 < text.length && /[\\`*_~[\]()#>!|-]/.test(text[i + 1] as string)) {
        buffer += text[i + 1];
        i += 2;
        continue;
      }
      if (ch === '`') {
        const ticks = /^`+/.exec(text.slice(i))?.[0] ?? '`';
        const end = text.indexOf(ticks, i + ticks.length);
        if (end > 0) {
          flush();
          let code = text.slice(i + ticks.length, end);
          if (code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
          out.push(withMarks(code, new Set([...marks, 'code']), link));
          i = end + ticks.length;
          continue;
        }
      }
      if (ch === '[' && !link) {
        const close = findClosing(text, i + 1, '](');
        const end = close < 0 ? -1 : text.indexOf(')', close + 2);
        if (close > i && end > close) {
          const href = text.slice(close + 2, end).trim();
          if (SAFE_LINK.test(href)) {
            flush();
            parse(text.slice(i + 1, close), new Set(marks), href);
            i = end + 1;
            continue;
          }
        }
      }
      const delimiter = DELIMITERS.find(([d]) => text.startsWith(d, i));
      if (delimiter && !marks.has(delimiter[1])) {
        const [d, mark] = delimiter;
        const end = findClosing(text, i + d.length, d);
        const inner = end < 0 ? '' : text.slice(i + d.length, end);
        // Intraword underscores (snake_case) are text, as in CommonMark.
        const intraword = d.startsWith('_') && /\w/.test(text[i - 1] ?? '');
        if (end > i + d.length && !/^\s|\s$/.test(inner) && !intraword) {
          flush();
          parse(inner, new Set([...marks, mark]), link);
          i = end + d.length;
          continue;
        }
      }
      buffer += ch;
      i += 1;
    }
    flush();
  };
  parse(source, new Set());
  return mergeSegments(out);
}

const escapeInline = (text: string) => text.replace(/([\\`*_~[\]])/g, '\\$1');

function wrapCode(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${ticks}${pad}${text}${pad}${ticks}`;
}

type OpenMark =
  | { kind: 'link'; href: string }
  | { kind: 'bold' | 'strike' }
  | { kind: 'italic'; delimiter: '_' | '*' };

const sameOpenMark = (a: OpenMark, b: OpenMark) =>
  a.kind === b.kind && (a.kind !== 'link' || b.kind !== 'link' || a.href === b.href);

/** A segment's marks, outermost first: the link wraps everything, code is per run. */
function marksOf(segment: Segment): OpenMark[] {
  const marks: OpenMark[] = [];
  if (segment.link) marks.push({ kind: 'link', href: segment.link });
  if (segment.bold) marks.push({ kind: 'bold' });
  if (segment.strike) marks.push({ kind: 'strike' });
  if (segment.italic) marks.push({ kind: 'italic', delimiter: '_' });
  return marks;
}

/**
 * Segments → Markdown inline text. Underline and colours have no Markdown
 * and are dropped.
 *
 * Marks are opened and closed only where they change between runs, so two
 * italic runs side by side read `_ab_`, not `_a__b_` (which is bold).
 * Emphasis never hugs whitespace: spaces at a run's edges are written
 * outside its marks. Italic after a letter uses `*`, since `_` inside a word
 * is text.
 */
export function renderInline(segments: readonly Segment[]): string {
  const runs: Segment[] = [];
  for (const segment of mergeSegments(segments)) {
    if (segment.code) {
      runs.push(segment);
      continue;
    }
    const [, lead = '', core = '', trail = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(segment.text) ?? [];
    const bare = segment.link ? { link: segment.link } : {};
    if (lead) runs.push({ text: lead, ...bare });
    if (core) runs.push({ ...segment, text: core });
    if (trail) runs.push({ text: trail, ...bare });
  }

  let out = '';
  const open: OpenMark[] = [];
  const close = (mark: OpenMark) => {
    if (mark.kind === 'link') out += `](${mark.href.replace(/\)/g, '%29').replace(/\s/g, '%20')})`;
    else if (mark.kind === 'italic') out += mark.delimiter;
    else out += mark.kind === 'bold' ? '**' : '~~';
  };
  const begin = (mark: OpenMark): OpenMark => {
    if (mark.kind === 'link') out += '[';
    else if (mark.kind === 'italic') {
      const delimiter = /\w$/.test(out) ? '*' : '_';
      out += delimiter;
      return { kind: 'italic', delimiter };
    } else out += mark.kind === 'bold' ? '**' : '~~';
    return mark;
  };
  for (const run of runs) {
    const wanted = marksOf(run);
    let keep = 0;
    while (
      keep < open.length &&
      keep < wanted.length &&
      sameOpenMark(open[keep] as OpenMark, wanted[keep] as OpenMark)
    )
      keep += 1;
    for (let i = open.length - 1; i >= keep; i -= 1) close(open[i] as OpenMark);
    open.length = keep;
    for (let i = keep; i < wanted.length; i += 1) open.push(begin(wanted[i] as OpenMark));
    out += run.code ? wrapCode(run.text) : escapeInline(run.text);
  }
  for (let i = open.length - 1; i >= 0; i -= 1) close(open[i] as OpenMark);
  return out;
}

// ───────────────────────────── Markdown → blocks ─────────────────────────────

const textContent = (source: string): BlockContent => {
  const segments = parseInline(source);
  return { text: plainText(segments), segments };
};

const node = (type: BlockType, content: BlockContent, children: BlockNode[] = []): BlockNode => ({
  type,
  content,
  children,
});

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(\[( |x|X)\]\s+)?(.*)$/;
const indentOf = (spaces: string) => spaces.replace(/\t/g, '    ').length;

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '\\' && body[i + 1] === '|') {
      current += '|';
      i += 1;
    } else if (ch === '|') {
      cells.push(current.trim());
      current = '';
    } else current += ch;
  }
  cells.push(current.trim());
  return cells;
}

/** Markdown → block trees. A leading `# Title` is not a block: see `markdownTitle`. */
export function markdownToBlocks(markdown: string): BlockNode[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const roots: BlockNode[] = [];
  // Open list items by indentation, so deeper items nest under them.
  let listStack: { indent: number; node: BlockNode }[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) roots.push(node('paragraph', textContent(paragraph.join('\n'))));
    paragraph = [];
  };
  const closeLists = () => {
    listStack = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;

    const fence = /^(\s*)(```+|~~~+)\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      flushParagraph();
      closeLists();
      const marker = fence[2] as string;
      const body: string[] = [];
      for (i += 1; i < lines.length && !(lines[i] as string).trim().startsWith(marker); i += 1)
        body.push(lines[i] as string);
      roots.push(node('code', { text: body.join('\n'), language: fence[3] || 'plain' }));
      continue;
    }
    if (/^\s*\$\$/.test(line)) {
      flushParagraph();
      closeLists();
      const body: string[] = [line.replace(/^\s*\$\$/, '')];
      while (!/\$\$\s*$/.test(body[body.length - 1] as string) && i + 1 < lines.length)
        body.push(lines[++i] as string);
      const latex = body
        .join('\n')
        .replace(/\$\$\s*$/, '')
        .trim();
      roots.push(node('equation', { latex }));
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      // A blank line ends a list only when what follows is not indented content.
      const next = lines[i + 1] ?? '';
      if (!LIST_ITEM.test(next)) closeLists();
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      flushParagraph();
      const indent = indentOf(item[1] as string);
      const ordered = /\d/.test(item[2] as string);
      const todo = item[3] !== undefined;
      const content = textContent(item[5] as string);
      const created = todo
        ? node('todo', { ...content, checked: (item[4] as string).toLowerCase() === 'x' })
        : node(ordered ? 'numbered_list_item' : 'bulleted_list_item', content);
      while (listStack.length > 0 && (listStack[listStack.length - 1]?.indent ?? 0) >= indent)
        listStack.pop();
      const parent = listStack[listStack.length - 1];
      (parent ? parent.node.children : roots).push(created);
      listStack.push({ indent, node: created });
      continue;
    }

    // Indented text right under a list item continues it, as a child paragraph.
    const continued = /^(\s{2,})(\S.*)$/.exec(line);
    const owner = listStack[listStack.length - 1];
    if (continued && owner && indentOf(continued[1] as string) > owner.indent) {
      owner.node.children.push(node('paragraph', textContent(continued[2] as string)));
      continue;
    }
    closeLists();

    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = Math.min((heading[1] as string).length, 3);
      roots.push(node(`heading_${level}` as BlockType, textContent(heading[2] as string)));
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushParagraph();
      roots.push(node('divider', {}));
      continue;
    }
    const image = /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/.exec(line);
    if (image) {
      flushParagraph();
      const url = image[2] as string;
      roots.push(
        /^https?:\/\//i.test(url)
          ? node('image', { url, alt: image[1] ?? '' })
          : node('paragraph', textContent(line)),
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      flushParagraph();
      const body: string[] = [line.replace(/^\s*>\s?/, '')];
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1] as string))
        body.push((lines[++i] as string).replace(/^\s*>\s?/, ''));
      // `> [!NOTE] text` (GitHub) and `> 💡 text` read as callouts.
      const callout = /^\[!(\w+)\]\s*(.*)$/s.exec(body.join('\n'));
      const emoji = /^(\p{Extended_Pictographic}️?)\s+(.*)$/su.exec(body.join('\n'));
      if (callout)
        roots.push(
          node('callout', { ...textContent(callout[2] as string), icon: 'icon:lightbulb' }),
        );
      else if (emoji)
        roots.push(
          node('callout', { ...textContent(emoji[2] as string), icon: `emoji:${emoji[1]}` }),
        );
      else roots.push(node('quote', textContent(body.join('\n'))));
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) {
      flushParagraph();
      const header = splitRow(line);
      const rows: string[][] = [header];
      for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i] as string); i += 1)
        rows.push(splitRow(lines[i] as string));
      i -= 1;
      const cols = Math.max(...rows.map((r) => r.length));
      roots.push(
        node(
          'table',
          { rows: rows.length, cols, withHeader: true },
          rows.map((cells) =>
            node(
              'table_row',
              {},
              Array.from({ length: cols }, (_, c) =>
                node('table_cell', textContent(cells[c] ?? '')),
              ),
            ),
          ),
        ),
      );
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  return roots;
}

/** The title a Markdown document gives itself: its first line, when that is a level-one heading. */
export function markdownTitle(markdown: string): { title: string | null; body: string } {
  const match = /^\s*#\s+(.+?)\s*#*\s*(\n|$)/.exec(markdown.replace(/\r\n?/g, '\n'));
  if (!match) return { title: null, body: markdown };
  return {
    title: plainText(parseInline(match[1] as string)),
    body: markdown.slice(match[0].length),
  };
}

// ───────────────────────────── blocks → trees ─────────────────────────────

/** Flat stored blocks → trees, siblings in the server's order. */
export function blocksToTree(blocks: readonly FlatBlock[]): BlockNode[] {
  const byParent = new Map<string | null, FlatBlock[]>();
  const ids = new Set(blocks.map((b) => b.id));
  for (const block of blocks) {
    const parent = block.parentBlockId && ids.has(block.parentBlockId) ? block.parentBlockId : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), block]);
  }
  const build = (parent: string | null): BlockNode[] =>
    (byParent.get(parent) ?? [])
      .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((b) => ({ type: b.type as BlockType, content: b.content, children: build(b.id) }));
  return build(null);
}

/** A block's text as segments: its `segments`, or its plain `text` as one. */
export const segmentsOf = (content: BlockContent): Segment[] => {
  const segments = content.segments;
  if (Array.isArray(segments) && segments.length > 0) return segments as Segment[];
  return typeof content.text === 'string' && content.text ? [{ text: content.text }] : [];
};
const stringOf = (value: unknown) => (typeof value === 'string' ? value : '');

// ───────────────────────────── blocks → Markdown ─────────────────────────────

const LISTISH = new Set(['bulleted_list_item', 'numbered_list_item', 'todo', 'toggle']);

function renderNodeMarkdown(block: BlockNode, depth: number, index: number): string {
  const indent = '    '.repeat(depth);
  const inline = renderInline(segmentsOf(block.content));
  const childIndent = LISTISH.has(block.type) ? depth + 1 : depth;
  const children = block.children
    .map((child, i) => renderNodeMarkdown(child, childIndent, i))
    .filter(Boolean)
    .join(LISTISH.has(block.type) ? '\n' : '\n\n');
  let line: string;
  switch (block.type) {
    case 'heading_1':
      line = `# ${inline}`;
      break;
    case 'heading_2':
      line = `## ${inline}`;
      break;
    case 'heading_3':
      line = `### ${inline}`;
      break;
    case 'bulleted_list_item':
    case 'toggle':
      line = `${indent}- ${inline}`;
      break;
    case 'numbered_list_item':
      line = `${indent}${index + 1}. ${inline}`;
      break;
    case 'todo':
      line = `${indent}- [${block.content.checked === true ? 'x' : ' '}] ${inline}`;
      break;
    case 'quote':
      line = inline
        .split('\n')
        .map((l) => `${indent}> ${l}`)
        .join('\n');
      break;
    case 'callout': {
      const icon = stringOf(block.content.icon);
      const emoji = icon.startsWith('emoji:') ? `${icon.slice('emoji:'.length)} ` : '';
      line = `${indent}> ${emoji}${inline}`;
      break;
    }
    case 'divider':
      line = `${indent}---`;
      break;
    case 'code': {
      const text = stringOf(block.content.text);
      const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
      const fence = '`'.repeat(longest + 1);
      const language = stringOf(block.content.language);
      line = `${fence}${language === 'plain' ? '' : language}\n${text}\n${fence}`;
      break;
    }
    case 'equation':
      line = `$$\n${stringOf(block.content.latex)}\n$$`;
      break;
    case 'image':
      line = `![${escapeInline(stringOf(block.content.alt))}](${stringOf(block.content.url)})`;
      break;
    case 'video':
    case 'audio':
    case 'file':
    case 'pdf':
    case 'bookmark':
    case 'embed': {
      const url = stringOf(block.content.url);
      const label = stringOf(block.content.title) || stringOf(block.content.name) || url;
      line = url ? `[${escapeInline(label)}](${url})` : '';
      break;
    }
    case 'table': {
      const rows = block.children.map((row) =>
        row.children.map((cell) =>
          renderInline(segmentsOf(cell.content)).replace(/\|/g, '\\|').replace(/\n/g, ' '),
        ),
      );
      const cols = Math.max(1, ...rows.map((r) => r.length));
      const pad = (r: string[]) =>
        `| ${Array.from({ length: cols }, (_, c) => r[c] ?? '').join(' | ')} |`;
      const [head = [], ...rest] = rows;
      return [
        pad(head),
        `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`,
        ...rest.map(pad),
      ].join('\n');
    }
    case 'columns':
    case 'column':
    case 'canvas_note':
    case 'table_row':
    case 'sync_block':
      return children;
    default:
      line = inline ? `${indent}${inline}` : '';
  }
  if (!children) return line;
  return line ? `${line}${LISTISH.has(block.type) ? '\n' : '\n\n'}${children}` : children;
}

/** Block trees → Markdown, with an optional `# title` first. */
export function blocksToMarkdown(blocks: readonly BlockNode[], title?: string): string {
  const parts: string[] = [];
  let run: string[] = [];
  // Consecutive list items stay together; everything else is separated by a blank line.
  const flush = () => {
    if (run.length > 0) parts.push(run.join('\n'));
    run = [];
  };
  let numbered = 0;
  for (const block of blocks) {
    numbered = block.type === 'numbered_list_item' ? numbered + 1 : 0;
    const rendered = renderNodeMarkdown(block, 0, Math.max(0, numbered - 1));
    if (!rendered) continue;
    if (LISTISH.has(block.type)) run.push(rendered);
    else {
      flush();
      parts.push(rendered);
    }
  }
  flush();
  const body = parts.join('\n\n');
  return `${title !== undefined ? `# ${escapeInline(title || 'Untitled')}\n\n` : ''}${body}\n`;
}

// ───────────────────────────── blocks → HTML ─────────────────────────────

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => ESCAPES[ch] as string);
const safeUrl = (url: string) => (SAFE_LINK.test(url.trim()) ? escapeHtml(url.trim()) : '#');

function renderInlineHtml(segments: readonly Segment[]): string {
  return mergeSegments(segments)
    .map((segment) => {
      let out = escapeHtml(segment.text).replace(/\n/g, '<br>');
      if (segment.code) out = `<code>${out}</code>`;
      if (segment.strike) out = `<s>${out}</s>`;
      if (segment.underline) out = `<u>${out}</u>`;
      if (segment.italic) out = `<em>${out}</em>`;
      if (segment.bold) out = `<strong>${out}</strong>`;
      if (segment.link)
        out = `<a href="${safeUrl(segment.link)}" rel="noopener noreferrer">${out}</a>`;
      return out;
    })
    .join('');
}

function renderNodesHtml(blocks: readonly BlockNode[]): string {
  const out: string[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i] as BlockNode;
    const listTag =
      block.type === 'bulleted_list_item' || block.type === 'todo' || block.type === 'toggle'
        ? 'ul'
        : block.type === 'numbered_list_item'
          ? 'ol'
          : null;
    if (listTag) {
      // Consecutive items of one kind of list share the list element.
      const items: BlockNode[] = [];
      while (i < blocks.length) {
        const next = blocks[i] as BlockNode;
        const nextTag =
          next.type === 'numbered_list_item'
            ? 'ol'
            : ['bulleted_list_item', 'todo', 'toggle'].includes(next.type)
              ? 'ul'
              : null;
        if (nextTag !== listTag) break;
        items.push(next);
        i += 1;
      }
      i -= 1;
      out.push(
        `<${listTag}>${items
          .map((item) => {
            const box =
              item.type === 'todo'
                ? `<input type="checkbox" disabled${item.content.checked === true ? ' checked' : ''}> `
                : '';
            const nested = item.children.length > 0 ? renderNodesHtml(item.children) : '';
            const body = `${box}${renderInlineHtml(segmentsOf(item.content))}`;
            return item.type === 'toggle'
              ? `<li><details open><summary>${body}</summary>${nested}</details></li>`
              : `<li>${body}${nested}</li>`;
          })
          .join('')}</${listTag}>`,
      );
      continue;
    }
    const inline = renderInlineHtml(segmentsOf(block.content));
    const children = block.children.length > 0 ? renderNodesHtml(block.children) : '';
    switch (block.type) {
      case 'heading_1':
        out.push(`<h1>${inline}</h1>`);
        break;
      case 'heading_2':
        out.push(`<h2>${inline}</h2>`);
        break;
      case 'heading_3':
        out.push(`<h3>${inline}</h3>`);
        break;
      case 'quote':
        out.push(`<blockquote>${inline}${children}</blockquote>`);
        break;
      case 'callout': {
        const icon = stringOf(block.content.icon);
        const emoji = icon.startsWith('emoji:')
          ? `<span class="icon">${escapeHtml(icon.slice(6))}</span> `
          : '';
        out.push(`<aside class="callout">${emoji}<div>${inline}${children}</div></aside>`);
        break;
      }
      case 'divider':
        out.push('<hr>');
        break;
      case 'code':
        out.push(
          `<pre><code class="language-${escapeHtml(stringOf(block.content.language) || 'plain')}">${escapeHtml(stringOf(block.content.text))}</code></pre>`,
        );
        break;
      case 'equation':
        out.push(`<div class="equation">${escapeHtml(stringOf(block.content.latex))}</div>`);
        break;
      case 'image': {
        const url = stringOf(block.content.url);
        if (url)
          out.push(
            `<figure><img src="${safeUrl(url)}" alt="${escapeHtml(stringOf(block.content.alt))}"></figure>`,
          );
        break;
      }
      case 'video':
      case 'audio':
      case 'file':
      case 'pdf':
      case 'bookmark':
      case 'embed': {
        const url = stringOf(block.content.url);
        const label = stringOf(block.content.title) || stringOf(block.content.name) || url;
        if (url)
          out.push(
            `<p><a href="${safeUrl(url)}" rel="noopener noreferrer">${escapeHtml(label)}</a></p>`,
          );
        break;
      }
      case 'table': {
        const rows = block.children.map(
          (row, r) =>
            `<tr>${row.children
              .map((cell) => {
                const tag = r === 0 && block.content.withHeader === true ? 'th' : 'td';
                return `<${tag}>${renderInlineHtml(segmentsOf(cell.content))}</${tag}>`;
              })
              .join('')}</tr>`,
        );
        out.push(`<table>${rows.join('')}</table>`);
        break;
      }
      case 'columns':
        out.push(`<div class="columns">${children}</div>`);
        break;
      case 'column':
        out.push(`<div class="column">${children}</div>`);
        break;
      case 'canvas_note':
        out.push(`<section class="note">${children}</section>`);
        break;
      default:
        if (inline || children) out.push(`${inline ? `<p>${inline}</p>` : ''}${children}`);
    }
  }
  return out.join('\n');
}

/** Block trees → the HTML of their content alone, escaped as in `blocksToHtml`. */
export function blocksToHtmlBody(blocks: readonly BlockNode[]): string {
  return renderNodesHtml(blocks);
}

/** The text of block trees in reading order, one space between blocks, cut at `limit` characters. */
export function blocksToText(
  blocks: readonly BlockNode[],
  limit = Number.POSITIVE_INFINITY,
): string {
  const parts: string[] = [];
  let length = 0;
  let left = false;
  const walk = (nodes: readonly BlockNode[]) => {
    for (const node of nodes) {
      if (length > limit) {
        left = true;
        return;
      }
      const text = segmentsOf(node.content)
        .map((segment) => segment.text)
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) {
        parts.push(text);
        length += text.length + 1;
      }
      walk(node.children);
    }
  };
  walk(blocks);
  const text = parts.join(' ');
  if (text.length <= limit && !left) return text;
  const cut = text.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Block trees → a standalone HTML document. */
export function blocksToHtml(blocks: readonly BlockNode[], title: string): string {
  const name = escapeHtml(title || 'Untitled');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.6;max-width:46rem;margin:3rem auto;padding:0 1rem;color:#1f2328}
pre{background:#f6f8fa;padding:1rem;overflow:auto;border-radius:6px}code{font-family:ui-monospace,monospace}
blockquote{border-left:3px solid #d0d7de;margin:0;padding-left:1rem;color:#57606a}
.callout{display:flex;gap:.5rem;background:#f6f8fa;padding:.75rem 1rem;border-radius:6px}
table{border-collapse:collapse}td,th{border:1px solid #d0d7de;padding:.25rem .5rem}
.columns{display:flex;gap:1.5rem}.column{flex:1}img{max-width:100%}
</style>
</head>
<body>
<h1>${name}</h1>
${renderNodesHtml(blocks)}
</body>
</html>
`;
}
