import { expect, test } from 'bun:test';

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
