import { expect, test } from 'bun:test';

// `public/sw.js` registers its listeners on `self` when loaded; outside a
// browser that is a stand-in, and the file hands back its routing rule.
(globalThis as { self?: unknown }).self = {
  addEventListener: () => {},
  location: { origin: 'https://nilo.example' },
};
const { strategyFor, staleBundles } = require('../apps/app/public/sw.js') as {
  strategyFor: (request: Request, origin: string) => string | null;
  staleBundles: (shell: string, kept: Map<string, string>) => string[] | null;
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

const shell = (...bundles: string[]) =>
  `<html><head>${bundles.map((b) => `<script src="${b}" defer></script>`).join('')}</head></html>`;
const js = (name: string) => `/_expo/static/js/web/${name}.js`;

test('drops the bundles of a replaced app, keeping what the shell loads however deep', () => {
  const kept = new Map([
    // The app now: its entry loads a chunk, which loads another, and a chunk
    // no deploy changed.
    [js('index-new'), `__loadBundleAsync("${js('mermaid-1')}"); "${js('fr-1')}"`],
    [js('mermaid-1'), `"${js('flow-1')}"`],
    [js('flow-1'), ''],
    [js('fr-1'), ''],
    // The app a deploy replaced.
    [js('index-old'), `"${js('fr-1')}" "${js('katex-old')}"`],
    [js('katex-old'), ''],
  ]);
  expect(staleBundles(shell(js('index-new')), kept)?.sort()).toEqual([
    js('index-old'),
    js('katex-old'),
  ]);
});

test('keeps every bundle until the ones the shell names are kept, or for a page naming none', () => {
  const kept = new Map([[js('index-old'), '']]);
  expect(staleBundles(shell(js('index-new')), kept)).toBeNull();
  expect(staleBundles('<html>Sign in to the network</html>', kept)).toBeNull();
  expect(staleBundles(shell(js('index-old')), kept)).toEqual([]);
});
