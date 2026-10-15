import { afterEach, describe, expect, test } from 'bun:test';

const entry = '../apps/app/worker/index.js';
const spaFallback = () =>
  new Response('<html>app</html>', { headers: { 'Content-Type': 'text/html' } });

test('serves an existing asset unchanged', async () => {
  const worker = (await import(entry)).default;
  const response = new Response('asset', {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public,max-age=31536000,immutable',
    },
  });
  const result = await worker.fetch(new Request('https://example.com/image.png'), {
    ASSETS: { fetch: async () => response },
  });
  expect(result.status).toBe(200);
  expect(result.headers.get('Cache-Control')).toContain('immutable');
  expect(await result.text()).toBe('asset');
});

test('asset failures propagate the original error', async () => {
  const worker = (await import(entry)).default;
  const error = new Error('asset failure');
  await expect(
    worker.fetch(new Request('https://example.com/file.png'), {
      ASSETS: {
        fetch: async () => {
          throw error;
        },
      },
    }),
  ).rejects.toBe(error);
});

test('stale script requests still return 404 instead of the SPA HTML fallback', async () => {
  const worker = (await import(entry)).default;
  const result = await worker.fetch(new Request('https://example.com/_expo/static/stale.js'), {
    ASSETS: { fetch: async () => spaFallback() },
  });
  expect(result.status).toBe(404);
});

test('SPA navigation keeps the index.html fallback', async () => {
  const worker = (await import(entry)).default;
  const result = await worker.fetch(new Request('https://example.com/workspace/page'), {
    ASSETS: { fetch: async () => spaFallback() },
  });
  expect(result.status).toBe(200);
  expect(await result.text()).toBe('<html>app</html>');
});

describe('published pages', () => {
  const shell = () =>
    new Response(
      '<!doctype html><html><head><title>Nilo</title></head><body><div id="root"></div></body></html>',
      { headers: { 'Content-Type': 'text/html' } },
    );
  const page = (over: Record<string, unknown> = {}) => ({
    page: { id: 'p', title: 'Plan <b>2027</b>', cover: 'https://img.example/c.png' },
    blocks: [
      {
        id: 'a',
        parentBlockId: null,
        type: 'paragraph',
        content: { text: 'Hola <script>alert(1)</script> mundo' },
        order: 1,
      },
    ],
    site: { slug: 'plan', allowIndexing: true },
    ...over,
  });
  const realFetch = globalThis.fetch;
  let asked: string[] = [];
  const answer = (status: number, body: unknown) => {
    asked = [];
    globalThis.fetch = (async (input: string | URL) => {
      asked.push(String(input));
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
  };
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const visit = async (path: string, env: Record<string, unknown> = {}) => {
    const worker = (await import(entry)).default;
    return worker.fetch(new Request(`https://nilo.so${path}`), {
      API_URL: 'https://api.example.test',
      ASSETS: { fetch: async () => shell() },
      ...env,
    });
  };

  test('fills in the title, summary, card and text for readers without script', async () => {
    answer(200, page());
    const result = await visit('/pub/plan');
    const html = await result.text();
    expect(asked).toEqual(['https://api.example.test/public/pages/plan']);
    expect(html).toContain('<title>Plan &lt;b&gt;2027&lt;/b&gt;</title>');
    expect(html).toContain('<meta property="og:title" content="Plan &lt;b&gt;2027&lt;/b&gt;">');
    expect(html).toContain(
      '<meta name="description" content="Hola &lt;script&gt;alert(1)&lt;/script&gt; mundo">',
    );
    expect(html).toContain('<meta property="og:image" content="https://img.example/c.png">');
    expect(html).toContain('<link rel="canonical" href="https://nilo.so/pub/plan">');
    expect(html).toContain('<div id="root"><article><h1>Plan &lt;b&gt;2027&lt;/b&gt;</h1><p>Hola');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('noindex');
    expect(result.headers.get('X-Robots-Tag')).toBeNull();
  });

  test('keeps a page its owner did not open to search engines out of them', async () => {
    answer(200, page({ site: { slug: 'plan', allowIndexing: false } }));
    const result = await visit('/pub/plan/0190a3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b');
    expect(asked).toEqual([
      'https://api.example.test/public/pages/plan/0190a3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b',
    ]);
    expect(await result.text()).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(result.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  test('reads a canvas page top to bottom, then left to right', async () => {
    const note = (id: string, x: number, y: number, text: string) => [
      { id, parentBlockId: null, type: 'canvas_note', content: { x, y }, order: 1 },
      { id: `${id}-p`, parentBlockId: id, type: 'paragraph', content: { text }, order: 1 },
    ];
    answer(200, page({ blocks: [...note('b', 0, 500, 'Second'), ...note('a', 0, 0, 'First')] }));
    const html = await (await visit('/pub/plan')).text();
    expect(html.indexOf('First')).toBeLessThan(html.indexOf('Second'));
    expect(html).toContain('<meta name="description" content="First Second">');
  });

  test('serves the app unchanged when the page is not published', async () => {
    answer(404, { error: 'This page is not published' });
    const result = await visit('/pub/gone');
    expect(await result.text()).toContain('<title>Nilo</title>');
  });

  test('asks nothing without an API origin, or for a malformed page id', async () => {
    answer(200, page());
    expect(await (await visit('/pub/plan', { API_URL: undefined })).text()).toContain(
      '<title>Nilo</title>',
    );
    expect(await (await visit('/pub/plan/not-an-id')).text()).toContain('<title>Nilo</title>');
    expect(asked).toEqual([]);
  });
});
