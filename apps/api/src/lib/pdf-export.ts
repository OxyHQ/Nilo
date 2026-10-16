/**
 * A page as a PDF, drawn from the same block tree the Markdown and HTML
 * exports read (`@oxy.so/nilo-contracts`), on the server for every platform alike.
 *
 * Text is set in embedded Inter and JetBrains Mono (subset, with a Unicode
 * map, so it can be searched and copied): Latin, Greek and Cyrillic. Images
 * are embedded when `loadImage` returns PNG or JPEG bytes; anything else a
 * block points at becomes a link.
 */
import { createRequire } from 'node:module';
import { type BlockNode, mergeSegments, type Segment, segmentsOf } from '@oxy.so/nilo-contracts';
import PDFDocument from 'pdfkit';

declare global {
  namespace PDFKit {
    interface PDFDocument {
      /** Decodes an image once, for its size (pdfkit API its types omit). */
      openImage(src: Buffer): { width: number; height: number };
    }
  }
}

const require = createRequire(import.meta.url);
const FONTS = {
  regular: require.resolve('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
  bold: require.resolve('@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf'),
  italic: require.resolve('@expo-google-fonts/inter/400Regular_Italic/Inter_400Regular_Italic.ttf'),
  boldItalic: require.resolve('@expo-google-fonts/inter/700Bold_Italic/Inter_700Bold_Italic.ttf'),
  mono: require.resolve(
    '@expo-google-fonts/jetbrains-mono/400Regular/JetBrainsMono_400Regular.ttf',
  ),
} as const;

const MARGIN = 56;
const BODY = 11;
const INDENT = 18;
const TEXT = '#1f2328';
const MUTED = '#57606a';
const LINK = '#0969da';
const RULE = '#d0d7de';
const SHADE = '#f6f8fa';
const HEADINGS = { heading_1: 20, heading_2: 16, heading_3: 13 } as const;
/** Blocks that only hold others: their content goes where they are, not indented. */
const CONTAINERS = new Set(['columns', 'column', 'canvas_note']);

/** Bytes of an image a block points at, or null to show it as a link. */
export type ImageLoader = (url: string) => Promise<Buffer | null>;

const stringOf = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * What one export may take in images: how many, how much at once, how many
 * bytes in all, and how large each may be decoded. pdfkit decodes a PNG with
 * transparency into memory, so a small file declaring a huge canvas is refused
 * from its header, before pdfkit sees it.
 */
export const IMAGE_LIMITS = {
  count: 30,
  concurrency: 4,
  totalBytes: 40 * 1024 * 1024,
  pixels: 25_000_000,
  side: 10_000,
} as const;

/** An image's size from its PNG or JPEG header; null when the header says nothing usable. */
export function imageSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes.readUInt32BE(12) === 0x49484452) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] as number;
    const length = bytes.readUInt16BE(at + 2);
    // Start of frame (baseline, progressive…), not DHT, JPG or DAC.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }
    at += 2 + length;
  }
  return null;
}

function withinPixelBudget(bytes: Buffer): boolean {
  const size = imageSize(bytes);
  if (!size || size.width === 0 || size.height === 0) return false;
  return (
    size.width <= IMAGE_LIMITS.side &&
    size.height <= IMAGE_LIMITS.side &&
    size.width * size.height <= IMAGE_LIMITS.pixels
  );
}

/**
 * The page's images, within `IMAGE_LIMITS`: the first ones in reading order,
 * a few at a time, until the byte budget is spent. The rest become links.
 */
async function loadImages(
  urls: readonly string[],
  loadImage: ImageLoader,
): Promise<Map<string, Buffer>> {
  const images = new Map<string, Buffer>();
  const queue = urls.slice(0, IMAGE_LIMITS.count);
  let spent = 0;
  const worker = async () => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      if (spent >= IMAGE_LIMITS.totalBytes) return;
      const bytes = await loadImage(url).catch(() => null);
      if (!bytes || !isEmbeddable(bytes) || !withinPixelBudget(bytes)) continue;
      if (spent + bytes.length > IMAGE_LIMITS.totalBytes) continue;
      spent += bytes.length;
      images.set(url, bytes);
    }
  };
  await Promise.all(Array.from({ length: IMAGE_LIMITS.concurrency }, worker));
  return images;
}

/** PNG or JPEG, the two formats a PDF embeds without converting. */
function isEmbeddable(bytes: Buffer): boolean {
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return png || jpeg;
}

class Writer {
  constructor(
    private readonly doc: PDFKit.PDFDocument,
    private readonly images: Map<string, Buffer>,
  ) {}

  private get width() {
    return this.doc.page.width - MARGIN * 2;
  }

  private font(segment: Segment) {
    if (segment.code) return 'mono';
    if (segment.bold && segment.italic) return 'boldItalic';
    if (segment.bold) return 'bold';
    if (segment.italic) return 'italic';
    return 'regular';
  }

  /** Room for `height` on this page, or a new one. */
  private ensure(height: number) {
    if (this.doc.y + height > this.doc.page.height - MARGIN) this.doc.addPage();
  }

  /** A run of formatted text at `x`, as wide as the page allows from there. */
  inline(
    segments: readonly Segment[],
    x: number,
    options: { size?: number; bold?: boolean; color?: string } = {},
  ) {
    const doc = this.doc;
    const runs = mergeSegments(segments).filter((s) => s.text.length > 0);
    const width = this.width - (x - MARGIN);
    const size = options.size ?? BODY;
    if (runs.length === 0) {
      doc.font('regular').fontSize(size).text(' ', x, doc.y, { width });
      return;
    }
    runs.forEach((run, i) => {
      const segment = options.bold ? { ...run, bold: true } : run;
      doc
        .font(this.font(segment))
        .fontSize(run.code ? size * 0.9 : size)
        .fillColor(run.link ? LINK : (options.color ?? TEXT));
      const settings = {
        width,
        continued: i < runs.length - 1,
        underline: Boolean(run.underline || run.link),
        strike: Boolean(run.strike),
        link: run.link ?? null,
        lineGap: 2,
      };
      if (i === 0) doc.text(run.text, x, doc.y, settings);
      else doc.text(run.text, settings);
    });
    doc.fillColor(TEXT);
  }

  private gap(points: number) {
    this.doc.y += points;
  }

  private marker(x: number, draw: (top: number) => void) {
    this.ensure(BODY * 1.6);
    draw(this.doc.y);
    return x + INDENT;
  }

  nodes(blocks: readonly BlockNode[], depth: number) {
    let number = 0;
    for (const block of blocks) {
      number = block.type === 'numbered_list_item' ? number + 1 : 0;
      this.node(block, depth, number);
    }
  }

  private node(block: BlockNode, depth: number, number: number) {
    const doc = this.doc;
    const x = MARGIN + depth * INDENT;
    const text = segmentsOf(block.content);
    switch (block.type) {
      case 'heading_1':
      case 'heading_2':
      case 'heading_3': {
        const size = HEADINGS[block.type];
        this.gap(size * 0.6);
        this.ensure(size * 2.5);
        this.inline(text, x, { size, bold: true });
        this.gap(2);
        this.nodes(block.children, depth + 1);
        return;
      }
      case 'bulleted_list_item':
      case 'numbered_list_item':
      case 'todo':
      case 'toggle': {
        const textX = this.marker(x, (top) => {
          doc.font('regular').fontSize(BODY).fillColor(TEXT);
          if (block.type === 'bulleted_list_item') doc.text('•', x + 4, top, { lineBreak: false });
          else if (block.type === 'numbered_list_item')
            doc.text(`${number}.`, x, top, { lineBreak: false });
          else if (block.type === 'toggle') doc.text('›', x + 4, top, { lineBreak: false });
          else {
            const side = BODY * 0.8;
            const boxTop = top + 2;
            doc
              .lineWidth(0.8)
              .strokeColor(MUTED)
              .rect(x + 1, boxTop, side, side)
              .stroke();
            if (block.content.checked === true) {
              doc
                .lineWidth(1.2)
                .moveTo(x + 3, boxTop + side * 0.55)
                .lineTo(x + side * 0.45, boxTop + side - 2)
                .lineTo(x + side - 1, boxTop + 2)
                .stroke();
            }
          }
          doc.y = top;
        });
        this.inline(text, textX, {
          color: block.type === 'todo' && block.content.checked === true ? MUTED : TEXT,
        });
        this.gap(3);
        this.nodes(block.children, depth + 1);
        return;
      }
      case 'quote': {
        const top = doc.y;
        const startPage = doc.page;
        this.inline(text, x + 12, { color: MUTED });
        this.nodes(block.children, depth + 1);
        if (doc.page === startPage) {
          doc
            .lineWidth(2.5)
            .strokeColor(RULE)
            .moveTo(x + 2, top)
            .lineTo(x + 2, doc.y)
            .stroke();
        }
        this.gap(6);
        return;
      }
      case 'callout': {
        const width = this.width - (x - MARGIN);
        doc.font('regular').fontSize(BODY);
        const height = doc.heightOfString(text.map((s) => s.text).join('') || ' ', {
          width: width - 24,
          lineGap: 2,
        });
        this.ensure(height + 20);
        const top = doc.y;
        doc.roundedRect(x, top, width, height + 16, 4).fill(SHADE);
        doc.fillColor(TEXT);
        doc.y = top + 8;
        this.inline(text, x + 12);
        doc.y = top + height + 16;
        this.gap(6);
        this.nodes(block.children, depth + 1);
        return;
      }
      case 'divider': {
        this.ensure(16);
        this.gap(6);
        doc
          .lineWidth(0.8)
          .strokeColor(RULE)
          .moveTo(x, doc.y)
          .lineTo(MARGIN + this.width, doc.y)
          .stroke();
        this.gap(10);
        return;
      }
      case 'code':
      case 'equation':
      case 'mermaid': {
        const source = stringOf(
          block.type === 'equation' ? block.content.latex : block.content.text,
        );
        const width = this.width - (x - MARGIN);
        doc.font('mono').fontSize(BODY * 0.85);
        const height = doc.heightOfString(source || ' ', { width: width - 20, lineGap: 1 });
        const fits = height + 16 <= doc.page.height - MARGIN * 2;
        if (fits) this.ensure(height + 16);
        const top = doc.y;
        if (fits) doc.rect(x, top, width, height + 16).fill(SHADE);
        doc
          .fillColor(TEXT)
          .font('mono')
          .fontSize(BODY * 0.85);
        doc.text(source || ' ', x + 10, top + 8, { width: width - 20, lineGap: 1 });
        doc.y += 8;
        this.gap(6);
        return;
      }
      case 'image': {
        const url = stringOf(block.content.url);
        const bytes = url ? this.images.get(url) : undefined;
        if (bytes) {
          const width = this.width - (x - MARGIN);
          const image = doc.openImage(bytes);
          const scale = Math.min(1, width / image.width, 420 / image.height);
          this.ensure(image.height * scale + 8);
          doc.image(bytes, x, doc.y, { width: image.width * scale });
          doc.y += image.height * scale;
          const caption = stringOf(block.content.caption);
          if (caption) {
            this.gap(2);
            this.inline([{ text: caption }], x, { size: BODY * 0.85, color: MUTED });
          }
          this.gap(8);
        } else if (url) {
          this.inline([{ text: stringOf(block.content.alt) || url, link: url }], x);
          this.gap(4);
        }
        return;
      }
      case 'video':
      case 'audio':
      case 'file':
      case 'pdf':
      case 'bookmark':
      case 'embed': {
        const url = stringOf(block.content.url);
        const label = stringOf(block.content.title) || stringOf(block.content.name) || url;
        if (url) {
          this.inline([{ text: label, link: url }], x);
          this.gap(4);
        }
        return;
      }
      case 'table':
        this.table(block, x);
        return;
      default: {
        if (text.length > 0) {
          this.inline(text, x);
          this.gap(5);
        }
        // Columns, canvas notes and other containers: their content, one after another.
        this.nodes(block.children, CONTAINERS.has(block.type) ? depth : depth + 1);
      }
    }
  }

  private table(block: BlockNode, x: number) {
    const doc = this.doc;
    const rows = block.children;
    const columns = Math.max(1, ...rows.map((row) => row.children.length));
    const width = (this.width - (x - MARGIN)) / columns;
    const pad = 5;
    rows.forEach((row, r) => {
      const header = r === 0 && block.content.withHeader === true;
      const cells = Array.from({ length: columns }, (_, c) => row.children[c]);
      doc.fontSize(BODY * 0.9);
      const height =
        Math.max(
          ...cells.map((cell) => {
            doc.font(header ? 'bold' : 'regular');
            const content = cell
              ? segmentsOf(cell.content)
                  .map((s) => s.text)
                  .join('')
              : '';
            return doc.heightOfString(content || ' ', { width: width - pad * 2, lineGap: 1 });
          }),
        ) +
        pad * 2;
      this.ensure(height);
      const top = doc.y;
      cells.forEach((cell, c) => {
        const left = x + c * width;
        if (header) doc.rect(left, top, width, height).fill(SHADE);
        doc.lineWidth(0.6).strokeColor(RULE).rect(left, top, width, height).stroke();
        doc.y = top + pad;
        if (cell)
          this.inline(segmentsOf(cell.content), left + pad, { size: BODY * 0.9, bold: header });
      });
      doc.y = top + height;
    });
    this.gap(8);
  }
}

/** Every image URL in the tree, in order, once. */
function imageUrls(blocks: readonly BlockNode[], into: string[] = []): string[] {
  for (const block of blocks) {
    const url = block.type === 'image' ? stringOf(block.content.url) : '';
    if (url && !into.includes(url)) into.push(url);
    imageUrls(block.children, into);
  }
  return into;
}

/** The page's blocks, under its title, as a PDF document. */
export async function blocksToPdf(
  blocks: readonly BlockNode[],
  title: string,
  loadImage: ImageLoader = async () => null,
): Promise<Buffer> {
  const images = await loadImages(imageUrls(blocks), loadImage);

  const name = title.trim() || 'Untitled';
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    bufferPages: true,
    info: { Title: name, Creator: 'Nilo' },
    lang: 'und',
  });
  for (const [key, path] of Object.entries(FONTS)) doc.registerFont(key, path);
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc
    .font('bold')
    .fontSize(26)
    .fillColor(TEXT)
    .text(name, MARGIN, MARGIN, {
      width: doc.page.width - MARGIN * 2,
    });
  doc.y += 12;
  new Writer(doc, images).nodes(blocks, 0);

  // Page numbers, once the page count is known.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('regular')
      .fontSize(8)
      .fillColor(MUTED)
      .text(`${i + 1} / ${range.count}`, MARGIN, doc.page.height - MARGIN / 2, {
        width: doc.page.width - MARGIN * 2,
        align: 'center',
        lineBreak: false,
      });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}
