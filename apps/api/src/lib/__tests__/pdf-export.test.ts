import { deflateSync } from 'node:zlib';
import type { BlockNode } from '@nilo/contracts';
import { describe, expect, it } from 'vitest';
import { blocksToPdf } from '../pdf-export.js';

const block = (
  type: BlockNode['type'],
  content: BlockNode['content'] = {},
  children: BlockNode[] = [],
): BlockNode => ({ type, content, children });

/** A 2×1 RGB PNG, built by hand: signature, IHDR, IDAT, IEND. */
function png(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.from([0, 255, 0, 0, 0, 0, 255]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const pages = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;

describe('blocksToPdf', () => {
  it('writes a PDF with the fonts embedded, for every kind of block', async () => {
    const pdf = await blocksToPdf(
      [
        block('heading_1', { text: 'Título' }),
        block('paragraph', {
          segments: [
            { text: 'Normal ' },
            { text: 'negrita', bold: true },
            { text: ' code', code: true },
          ],
        }),
        block('bulleted_list_item', { text: 'Uno' }, [
          block('numbered_list_item', { text: 'Dos' }),
        ]),
        block('todo', { text: 'Hecho', checked: true }),
        block('toggle', { text: 'Más' }, [block('paragraph', { text: 'Dentro' })]),
        block('quote', { text: 'Cita' }),
        block('callout', { text: 'Ojo', icon: 'emoji:💡' }),
        block('divider'),
        block('code', { text: 'const x = 1;', language: 'ts' }),
        block('equation', { latex: 'e^{i\\pi} + 1 = 0' }),
        block('table', { withHeader: true }, [
          block('table_row', {}, [
            block('table_cell', { text: 'A' }),
            block('table_cell', { text: 'B' }),
          ]),
          block('table_row', {}, [block('table_cell', { text: '1' })]),
        ]),
        block('bookmark', { url: 'https://example.com', title: 'Ejemplo' }),
        block('columns', {}, [block('column', {}, [block('paragraph', { text: 'Col' })])]),
      ],
      'Página — Кириллица',
    );
    const raw = pdf.toString('latin1');
    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw.trimEnd().endsWith('%%EOF')).toBe(true);
    for (const font of ['Inter-Regular', 'Inter-Bold', 'JetBrainsMono-Regular']) {
      expect(raw).toMatch(new RegExp(`/FontName /[A-Z]{6}\\+${font}`));
    }
    expect(raw).toContain('/URI (https://example.com)');
  });

  it('breaks a long page onto more pages', async () => {
    const long = Array.from({ length: 200 }, (_, i) => block('paragraph', { text: `Línea ${i}` }));
    expect(pages(await blocksToPdf(long, 'Larga'))).toBeGreaterThan(3);
  });

  it('embeds PNG and JPEG images and links anything else', async () => {
    const images = [
      block('image', { url: 'https://img.example/a.png' }),
      block('image', { url: 'https://img.example/b.svg', alt: 'Diagrama' }),
    ];
    const asked: string[] = [];
    const pdf = await blocksToPdf(images, 'Imágenes', async (url) => {
      asked.push(url);
      return url.endsWith('.png') ? png() : Buffer.from('<svg/>');
    });
    const raw = pdf.toString('latin1');
    expect(asked).toEqual(['https://img.example/a.png', 'https://img.example/b.svg']);
    expect(raw.match(/\/Subtype \/Image/g)).toHaveLength(1);
    expect(raw).toContain('/URI (https://img.example/b.svg)');
  });

  it('leaves out an image that fails to load', async () => {
    const pdf = await blocksToPdf([block('image', { url: 'https://img.example/x.png' })], 'X', () =>
      Promise.reject(new Error('offline')),
    );
    expect(pdf.toString('latin1')).not.toContain('/Subtype /Image');
  });
});
