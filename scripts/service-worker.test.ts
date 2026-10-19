import { expect, test } from 'bun:test';

// `public/sw.js` registers its listeners on `self` when loaded; outside a
// browser that is a stand-in, and the file hands back its routing rule.
(globalThis as { self?: unknown }).self = {
  addEventListener: () => {},
  location: { origin: 'https://nilo.example' },
};
const { strategyFor } = require('../apps/app/public/sw.js') as {
  strategyFor: (request: Request, origin: string) => string | null;
};

const origin = 'https://nilo.example';
const get = (path: string, init: RequestInit & { mode?: string } = {}) => {
  const request = new Request(new URL(path, origin), init);
  // `mode: 'navigate'` cannot be set on a constructed Request.
  return init.mode ? Object.defineProperty(request, 'mode', { value: init.mode }) : request;
};

test('a page of the app is answered from the network, else from the kept shell', () => {
  expect(strategyFor(get('/p/123', { mode: 'navigate' }), origin)).toBe('shell');
});

test('content-named bundles are kept once, icons are refreshed', () => {
  expect(strategyFor(get('/_expo/static/js/web/entry-abc.js'), origin)).toBe('immutable');
  expect(strategyFor(get('/icon-192.png'), origin)).toBe('asset');
});

test('leaves the API, other origins, published pages and writes alone', () => {
  expect(strategyFor(get('https://api.nilo.example/pages'), origin)).toBeNull();
  expect(strategyFor(get('/pub/site', { mode: 'navigate' }), origin)).toBeNull();
  expect(strategyFor(get('/_expo/static/x.js', { method: 'POST', body: 'x' }), origin)).toBeNull();
  expect(strategyFor(get('/api/anything'), origin)).toBeNull();
});
