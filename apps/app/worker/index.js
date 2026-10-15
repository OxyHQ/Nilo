/**
 * Nilo web Worker -- SPA routing with proper MIME-type handling.
 *
 * Moved here from `public/_worker.js` when the app left Cloudflare Pages for a
 * Worker. The behaviour it exists for is unchanged, and so is the reason:
 * `not_found_handling = "single-page-application"` serves index.html for ANY
 * miss, including a stale hashed bundle. A browser asked for `.js` and handed
 * `text/html` rejects it, so this returns a real 404 for asset extensions
 * instead.
 *
 * `run_worker_first = true` in wrangler.toml means this runs for every request
 * and passes it to `env.ASSETS`; it changes a response only for the stale-asset
 * case below. (That flag was set for the retired edge-activity observer; going
 * back to running only on a miss is a separate change.) `public/_headers` sets
 * the caching headers, and Workers static assets honours it.
 *
 * It must keep running as a Worker script rather than becoming Pages Advanced
 * Mode again: `public/_worker.js` was only ever loaded by Pages.
 */

import {
  blocksToHtmlBody,
  blocksToText,
  blocksToTree,
  escapeHtml,
  isEntityId,
} from '@nilo/contracts';

/** `/pub/<slug>` and `/pub/<slug>/<pageId>`: a published page and its subpages. */
const PUBLISHED = /^\/pub\/([a-z0-9-]{1,120})(?:\/([^/]+))?\/?$/;

/**
 * A published page as the API serves it to anyone, or null: no API origin
 * configured, an unpublished page, or no answer in time. Kept at the edge for
 * a minute, so readers do not each reach the API.
 */
async function readPublishedPage(env, slug, pageId) {
  let origin;
  try {
    origin = new URL(env.API_URL ?? '');
  } catch {
    return null;
  }
  if (origin.protocol !== 'https:' && origin.hostname !== '127.0.0.1') return null;
  const path = `/public/pages/${slug}${pageId ? `/${pageId}` : ''}`;
  try {
    const res = await fetch(new URL(path, origin), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * The app's page, with what a reader who runs no script needs: the published
 * page's title and summary for search engines and link previews, and its text
 * inside the root the app replaces once it starts.
 */
function withPublishedPage(response, data, url) {
  const title = data.page?.title?.trim() || 'Untitled';
  const tree = blocksToTree(data.blocks ?? []);
  const description = blocksToText(tree, 160);
  const canonical = `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  const cover =
    typeof data.page?.cover === 'string' && /^https:\/\//.test(data.page.cover)
      ? data.page.cover
      : null;
  const indexable = data.site?.allowIndexing === true;
  const meta = (attribute, name, content) =>
    `<meta ${attribute}="${name}" content="${escapeHtml(content)}">`;
  const head = [
    meta('name', 'description', description),
    meta('property', 'og:type', 'article'),
    meta('property', 'og:title', title),
    meta('property', 'og:description', description),
    meta('property', 'og:url', canonical),
    ...(cover ? [meta('property', 'og:image', cover)] : []),
    meta('name', 'twitter:card', cover ? 'summary_large_image' : 'summary'),
    meta('name', 'twitter:title', title),
    meta('name', 'twitter:description', description),
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    ...(indexable ? [] : [meta('name', 'robots', 'noindex, nofollow')]),
  ].join('');
  const article = `<article><h1>${escapeHtml(title)}</h1>${blocksToHtmlBody(tree)}</article>`;
  const rewritten = new HTMLRewriter()
    .on('title', { element: (el) => el.setInnerContent(title) })
    .on('head', { element: (el) => el.append(head, { html: true }) })
    .on('div#root', { element: (el) => el.prepend(article, { html: true }) })
    .transform(response);
  const headers = new Headers(rewritten.headers);
  if (!indexable) headers.set('X-Robots-Tag', 'noindex, nofollow');
  return new Response(rewritten.body, { status: rewritten.status, headers });
}

const STATIC_EXTENSIONS = new Set([
  '.css',
  '.js',
  '.mjs',
  '.json',
  '.map',
  '.wasm',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.webp',
  '.avif',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.mp4',
  '.webm',
  '.ogg',
  '.wav',
  '.pdf',
  '.xml',
  '.txt',
]);

function getExtension(pathname) {
  const lastDot = pathname.lastIndexOf('.');
  return lastDot === -1 ? '' : pathname.slice(lastDot).toLowerCase();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const extension = getExtension(pathname);

    // Try the asset pipeline first.
    const assetResponse = await env.ASSETS.fetch(request);
    const contentType = assetResponse.headers.get('content-type') || '';

    // Detect when the platform returns an HTML fallback for a static-asset URL.
    // If the URL has a known static extension but the response is HTML, the
    // actual file doesn't exist (e.g., stale hashed bundle from a previous
    // deploy). Return a clean 404 instead of HTML with the wrong MIME type.
    if (STATIC_EXTENSIONS.has(extension) && contentType.includes('text/html')) {
      return new Response('Not Found', { status: 404 });
    }

    // A published page: the app's page, filled in for readers without script.
    const published = PUBLISHED.exec(pathname);
    if (
      published &&
      contentType.includes('text/html') &&
      (published[2] === undefined || isEntityId(published[2]))
    ) {
      const data = await readPublishedPage(env, published[1], published[2]);
      if (data) return withPublishedPage(assetResponse, data, url);
    }

    // For non-asset paths (SPA navigation routes), the platform's index.html
    // fallback is correct behavior. Return the response as-is.
    return assetResponse;
  },
};
