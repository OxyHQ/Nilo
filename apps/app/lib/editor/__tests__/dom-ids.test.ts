import { PAGE_DOM_PREFIX, pageBlockDomId, syncedSurfacePrefix } from '../dom-ids';

it("finds the page's own blocks under Bloom's default prefix", () => {
  expect(PAGE_DOM_PREFIX).toBe('bloom-block-');
  expect(pageBlockDomId('b1')).toBe('bloom-block-b1');
});

it('gives each synced surface, and each path to one, a prefix of its own', () => {
  const outer = syncedSurfacePrefix(PAGE_DOM_PREFIX, 'r1');
  expect(outer).toBe('nilo-synced-r1-');
  expect(outer.startsWith(PAGE_DOM_PREFIX)).toBe(false);
  // The same reference shown inside another one is another surface.
  expect(syncedSurfacePrefix(outer, 'r2')).toBe('nilo-synced-r1-r2-');
  expect(syncedSurfacePrefix(PAGE_DOM_PREFIX, 'r2')).not.toBe(syncedSurfacePrefix(outer, 'r2'));
});
