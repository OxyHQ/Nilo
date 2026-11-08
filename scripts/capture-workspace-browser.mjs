// Nilo routes with local-only account/API fixtures and a seeded offline document.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const consumer = resolve(process.env.NILO_ROOT);
const require = createRequire(join(consumer, 'package.json'));
const browserRequire = createRequire(join(resolve(process.env.MENTION_ROOT), 'package.json'));
const { chromium } = browserRequire('@playwright/test');
const Y = require('yjs');
const { writeDocument } = require('@oxy.so/bloom-editor/yjs');
const origin = process.env.NILO_ORIGIN ?? 'http://localhost:8128';
const output = resolve(process.env.BASELINE_OUTPUT ?? 'docs/audits/issue-663/baseline/nilo');
mkdirSync(output, { recursive: true });
const date = '2026-11-08T06:00:00.000Z';
const user = {
  id: 'baseline-user',
  username: 'baseline-user',
  kind: 'personal',
  name: { displayName: 'Baseline Viewer' },
  email: 'viewer@example.test',
  avatar: null,
  verified: false,
  privacy: { isPrivate: false },
  counts: { followers: 0, following: 0, posts: 0 },
  locale: 'en',
};
const workspace = {
  id: 'baseline-workspace',
  name: 'Product workspace',
  avatar: null,
  ownerId: user.id,
  isPersonal: true,
  archivedAt: null,
  createdAt: date,
  updatedAt: date,
  role: 'owner',
};
const pageData = {
  id: 'baseline-document',
  workspaceId: workspace.id,
  teamspaceId: null,
  parentId: null,
  ownerId: user.id,
  title: 'Project brief',
  icon: null,
  cover: null,
  coverPosition: 50,
  publishedAt: null,
  publishSlug: null,
  publishIndexing: false,
  restricted: false,
  template: false,
  archived: false,
  favorited: false,
  order: 0,
  createdAt: date,
  updatedAt: date,
  databaseId: null,
  properties: {},
  fullWidth: false,
  smallText: false,
  font: 'default',
  mode: 'document',
  locked: false,
};
const database = {
  id: 'baseline-database',
  workspaceId: workspace.id,
  teamspaceId: null,
  name: 'Projects',
  icon: null,
  cover: null,
  ownerId: user.id,
  schema: {
    properties: [
      { id: 'name', name: 'Name', type: 'text' },
      {
        id: 'effort',
        name: 'Effort level',
        type: 'select',
        config: {
          options: [
            { id: 'medium', name: 'Medium', color: 'yellow' },
            { id: 'small', name: 'Small', color: 'green' },
          ],
        },
      },
    ],
  },
  isInline: false,
  parentPageId: null,
  archived: false,
  locked: false,
  systemKey: null,
  createdAt: date,
  updatedAt: date,
};
const view = {
  id: 'baseline-table',
  databaseId: database.id,
  name: 'Table',
  type: 'table',
  isDefault: true,
  filters: { kind: 'group', combinator: 'and', filters: [] },
  sorts: [],
  groupBy: null,
  hiddenProperties: [],
  frozenProperties: [],
  pageSize: 50,
  config: {},
  order: 0,
  createdAt: date,
  updatedAt: date,
};
const rowNames = [
  'Improve website copy',
  'Create new illustrations',
  'Social media post',
  'Create new videos',
  'Revise value props',
  'Create competitor list',
  'Launch new home page',
];
const rows = rowNames.map((title, index) => ({
  id: `baseline-row-${index}`,
  workspaceId: workspace.id,
  parentId: null,
  databaseId: database.id,
  title,
  icon: null,
  cover: null,
  ownerId: user.id,
  archived: false,
  order: index,
  properties: { effort: { optionId: index % 2 ? 'small' : 'medium' } },
  createdAt: date,
  updatedAt: date,
}));
let empty = false;
const report = {
  sourceSha: execFileSync('git', ['-C', consumer, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  presetVersion: require('@oxy.so/app-preset/package.json').version,
  sourceDiff: execFileSync('git', ['-C', consumer, 'diff', '--stat'], { encoding: 'utf8' }).trim(),
  bloomVersion: JSON.parse(readFileSync(require.resolve('@oxy.so/bloom/package.json'), 'utf8'))
    .version,
  observedAt: new Date().toISOString(),
  mode: 'development Metro; synthetic account/API; seeded offline document; no production API traffic',
  origin,
  frames: [],
  errors: [],
  unexpected: [],
  requests: [],
  checks: {},
};
const doc = new Y.Doc();
const ids = Array.from({ length: 30 }, (_, index) => `baseline-block-${index}`);
writeDocument(doc, {
  root: ids,
  blocks: Object.fromEntries(
    ids.map((id, index) => [
      id,
      {
        id,
        type: index === 0 ? 'heading_1' : 'paragraph',
        props: {},
        text: [
          {
            text:
              index === 0
                ? 'Project overview'
                : `Section ${index}: Define the scope, preserve the shared composition and verify the complete workflow.`,
            marks: [],
          },
        ],
        children: [],
      },
    ]),
  ),
});
const update = [...Y.encodeStateAsUpdate(doc)];
const expiresAt = new Date(Date.now() + 7200000).toISOString();
const token = [
  Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url'),
  Buffer.from(
    JSON.stringify({
      sub: user.id,
      userId: user.id,
      sessionId: 'baseline-session',
      exp: Math.floor(Date.now() / 1000) + 7200,
    }),
  ).toString('base64url'),
  'fixture',
].join('.');
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ['--no-sandbox'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'en-US',
  colorScheme: process.env.THEME ?? 'light',
  deviceScaleFactor: 1,
});
await context.routeWebSocket(
  (url) => url.host !== new URL(origin).host,
  (socket) => socket.close(),
);
await context.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  const method = request.method();
  if (url.origin === origin) {
    if (path === '/__baseline_seed')
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Fixture preparation</title>',
      });
    return route.continue();
  }
  report.requests.push(`${method} ${url.origin}${path}`);
  const headers = {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  };
  const json = (body) => route.fulfill({ json: body, headers });
  if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
  if (url.hostname === 'api.oxy.so') {
    if (path === '/accounts') return json({ accounts: [] });
    if (path === '/apps/assertions')
      return json({
        assertion: 'fixture-assertion',
        applicationId: 'fixture-app',
        platform: 'web',
        expiresAt,
      });
    if (path === '/session/device/directory')
      return json({
        deviceId: 'fixture-device',
        revision: 1,
        activeContextId: 'fixture-context',
        principals: [
          {
            id: 'fixture-principal',
            userId: user.id,
            authuser: 0,
            user,
            contexts: [
              {
                id: 'fixture-context',
                accountId: user.id,
                kind: 'personal',
                relationship: 'self',
                account: user,
                onDevice: true,
                available: true,
                active: true,
                lastUsedAt: Date.now(),
              },
            ],
          },
        ],
        updatedAt: Date.now(),
      });
    if (path === '/session/device/add')
      return route.fulfill({
        status: 503,
        headers,
        json: { message: 'Fixture does not register devices' },
      });

    if (path.startsWith('/auth/oauth/client/'))
      return json({
        application: {
          id: 'fixture-app',
          name: 'Read-only baseline',
          type: 'internal',
          isOfficial: true,
          isInternal: true,
          clientId: path.split('/').pop(),
          scopes: [],
        },
      });
    if (path === '/session/device/token')
      return json({
        accessToken: token,
        expiresAt,
        userId: user.id,
        sessionId: 'baseline-session',
        nextDeviceSecret: 'fixture-only',
        user,
      });
    if (path.startsWith('/session/user/') || path === '/users/me' || path === `/users/${user.id}`)
      return json(user);
    if (path.includes('/session/sessions') || path.startsWith('/session/device/sessions/'))
      return json([]);
    if (path === '/users/by-ids') return json({ users: [user] });
    if (path === '/safety/supervision') return json({ self: null, children: [], invitations: [] });
    if (path.includes('settings') || path.includes('preferences') || path.includes('entitlements'))
      return json({ language: 'en', theme: 'light', colorPreset: 'yellow' });
  }
  if (url.hostname === 'nilo-fixture.invalid') {
    if (method === 'POST' && path === `/pages/${pageData.id}/visit`)
      return route.fulfill({ status: 204, headers });
    if (method === 'GET') {
      if (path === '/workspaces') return json({ workspaces: [workspace] });
      if (path === `/workspaces/${workspace.id}`) return json({ workspace });
      if (path === `/workspaces/${workspace.id}/teamspaces`) return json({ teamspaces: [] });
      if (path === '/pages') return json({ pages: [pageData] });
      if (path === '/pages/shared') return json({ shared: [] });
      if (path === '/pages/recent') return json({ pages: [] });
      if (path === `/pages/${pageData.id}`) return json({ page: pageData, role: 'owner' });
      if (path === `/pages/${pageData.id}/breadcrumb`) return json({ breadcrumb: [] });
      if (path === `/pages/${pageData.id}/follow`) return json({ following: false });
      if (path === `/pages/${pageData.id}/backlinks`) return json({ backlinks: [] });
      if (path === `/pages/${pageData.id}/permissions`)
        return json({
          pageId: pageData.id,
          role: 'owner',
          restricted: false,
          restrictedFrom: null,
          openToWorkspace: true,
          grants: [],
        });
      if (path === `/pages/${pageData.id}/comments`) return json({ comments: [] });
      if (path === `/workspaces/${workspace.id}/members`)
        return json({ members: [{ userId: user.id, role: 'owner', user }] });
      if (path === '/notifications/vapid-public-key') return json({ publicKey: null });
      if (path === `/databases/${database.id}/automations`) return json({ automations: [] });
      if (path === '/notifications/unread-count') return json({ count: 0 });
      if (path === '/databases') return json({ databases: [database] });
      if (path === `/databases/${database.id}`)
        return json({ database, views: [view], role: 'owner' });
      if (path === `/databases/${database.id}/views`) return json({ views: [view] });
      if (path === `/databases/${database.id}/rows`)
        return json({
          rows: empty ? [] : rows,
          total: empty ? 0 : rows.length,
          cursor: null,
          view,
        });
      if (path === `/databases/${database.id}/templates`) return json({ templates: [] });
    }
  }
  report.unexpected.push(`${method} ${url.origin}${path}`);
  return route.abort();
});
const page = await context.newPage();
page.on('pageerror', (error) => report.errors.push(error.message));
page.on('console', async (message) => {
  if (message.type() === 'error') {
    for (const arg of message.args()) {
      try {
        const stack = await arg.evaluate((value) => value?.stack);
        if (stack) report.errors.push(stack);
      } catch {}
    }
  }
  if (message.type() === 'error' && message.args().length)
    report.errors.push(message.text().split('\n')[0]);
});
async function capture(name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(output, `${name}.png`), fullPage: false });
  report.frames.push({
    name,
    url: page.url(),
    ...(await page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      documentWidth: document.documentElement.scrollWidth,
      // Record visible text, excluding hidden app content.
      body: document.body.innerText.slice(0, 3500),
      regions: [
        ...document.querySelectorAll(
          '[data-bloom-screen-viewport],[data-bloom-panel-index],[data-testid="table-title-header"],[data-testid="database-view-toolbar"],[role="tablist"],[role="columnheader"],h1,h2',
        ),
      ]
        .filter((node) => {
          const box = node.getBoundingClientRect();
          return box.width && box.height;
        })
        .map((node) => {
          const box = node.getBoundingClientRect();
          const css = getComputedStyle(node);
          return {
            tag: node.tagName,
            testID: node.getAttribute('data-testid'),
            role: node.getAttribute('role'),
            text: node.matches('h1,h2,[role="columnheader"]') ? node.textContent : null,
            viewport: node.getAttribute('data-bloom-screen-viewport'),
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            padding: css.padding,
            fontSize: css.fontSize,
            lineHeight: css.lineHeight,
            scrollTop: node.scrollTop,
          };
        }),
    }))),
  });
}
try {
  await page.goto(`${origin}/__baseline_seed`);
  await page.evaluate(
    async ({ user, token, expiresAt, workspaceId, pageId, update }) => {
      localStorage.setItem(
        'oxy.auth.v1',
        JSON.stringify({
          sessionId: 'baseline-session',
          userId: user.id,
          deviceId: 'fixture-device',
          deviceSecret: 'fixture-only',
        }),
      );
      localStorage.setItem('oxy.auth.token.v1', JSON.stringify({ accessToken: token, expiresAt }));
      localStorage.setItem('nilo:account', user.id);
      localStorage.setItem(
        'workspace-store',
        JSON.stringify({ state: { currentWorkspaceId: workspaceId }, version: 0 }),
      );
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('nilo-documents', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          const updates = db.createObjectStore('updates', { keyPath: 'seq', autoIncrement: true });
          updates.createIndex('page', 'pageId');
          db.createObjectStore('pages', { keyPath: 'pageId' });
        };
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['updates', 'pages'], 'readwrite');
          tx.objectStore('updates').add({ pageId, data: new Uint8Array(update) });
          tx.objectStore('pages').put({ pageId, dirty: false });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { user, token, expiresAt, workspaceId: workspace.id, pageId: pageData.id, update },
  );
  await page.goto(`${origin}/db/${database.id}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  await Promise.race([
    page
      .getByRole('link', { name: 'Improve website copy', exact: true })
      .first()
      .waitFor({ timeout: 60000 }),
    page
      .getByText('Something went wrong', { exact: true })
      .waitFor({ timeout: 60000 })
      .then(() => {
        throw new Error('Application error boundary visible');
      }),
  ]);
  await capture('database-populated-1440');
  for (const width of [1024, 768, 390, 320, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await page.waitForTimeout(500);
    await capture(`database-populated-${width}`);
  }
  if (process.env.INTERACTIONS === '1') {
    const toolbar = page.getByTestId('database-view-toolbar');
    await toolbar.getByRole('button', { name: 'Search', exact: true }).click();
    const search = page.getByRole('textbox', { name: 'Search this view', exact: true });
    await search.fill('Improve');
    await search.evaluate((node) => {
      window.__niloSearch = node;
    });
    for (const width of [390, 320, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      assert.equal(await search.inputValue(), 'Improve');
      assert.equal(await search.evaluate((node) => node === window.__niloSearch), true);
    }
    report.checks.searchDraftAndNodeSurviveResize = true;
    await toolbar.getByRole('button', { name: 'Close search', exact: true }).click();
    await page.setViewportSize({ width: 320, height: 844 });
    await toolbar.getByRole('button', { name: 'New view', exact: true }).focus();
    const stops = [];
    for (let step = 0; step < 12; step++) {
      await page.waitForTimeout(300);
      stops.push(
        await page.evaluate(() => {
          const n = document.activeElement;
          const r = n.getBoundingClientRect();
          let left = 0;
          let right = innerWidth;
          for (let ancestor = n.parentElement; ancestor; ancestor = ancestor.parentElement) {
            if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(ancestor).overflowX)) {
              const clip = ancestor.getBoundingClientRect();
              left = Math.max(left, clip.left);
              right = Math.min(right, clip.right);
            }
          }
          return {
            clipLeft: left,
            clipRight: right,
            fullyInsideScrollClip: r.width > 0 && r.left >= left - 1 && r.right <= right + 1,
            label: n.getAttribute('aria-label') || n.textContent,
            x: r.x,
            width: r.width,
            visible: r.width > 0 && r.x >= 0 && r.right <= innerWidth,
          };
        }),
      );
      await page.keyboard.press('Tab');
    }
    report.checks.toolbarKeyboardStops320 = stops;
    for (const label of [
      'New view',
      'Search',
      'Filter',
      'Sort',
      'Add property',
      'New',
      'Row templates',
    ]) {
      assert.ok(
        stops.some((stop) => stop.label === label && stop.visible),
        `Keyboard reaches ${label}`,
      );
    }
    await capture('database-keyboard-320');
    const searchButton = toolbar.getByRole('button', { name: 'Search', exact: true });
    await searchButton.focus();
    await capture('database-search-focus-320');
    await searchButton.evaluate((node) => {
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (
          parent.scrollWidth > parent.clientWidth &&
          getComputedStyle(parent).overflowX === 'auto'
        ) {
          parent.scrollLeft = 0;
          break;
        }
      }
    });
    await page.mouse.move(130, 160);
    await page.mouse.wheel(50, 0);
    await page.waitForTimeout(300);
    report.checks.searchAfterHorizontalWheel = await searchButton.evaluate((node) => {
      const r = node.getBoundingClientRect();
      let left = 0;
      let right = innerWidth;
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowX)) {
          const clip = parent.getBoundingClientRect();
          left = Math.max(left, clip.left);
          right = Math.min(right, clip.right);
        }
      }
      return {
        x: r.x,
        width: r.width,
        clipLeft: left,
        clipRight: right,
        fullyInsideScrollClip: r.left >= left - 1 && r.right <= right + 1,
      };
    });
    await capture('database-search-wheel-320');
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  empty = true;
  await page.reload();
  await page.getByText('Projects', { exact: true }).first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(1000);
  await capture('database-empty-1440');
  await page.goto(`${origin}/p/${pageData.id}`);
  await page.getByText('Project overview', { exact: true }).first().waitFor({ timeout: 60000 });
  await capture('document-1440');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await capture('document-390');
  report.editorInputs = await page
    .locator('textarea,input,[contenteditable=true]')
    .evaluateAll((nodes) =>
      nodes.map((n) => ({
        tag: n.tagName,
        role: n.getAttribute('role'),
        label: n.getAttribute('aria-label'),
        value: n.value?.slice(0, 100),
        content: n.textContent?.slice(0, 100),
      })),
    );
  if (process.env.INTERACTIONS === '1') {
    const paragraph = page
      .locator('[contenteditable=true]')
      .filter({ hasText: 'Section 1: Define' })
      .first();
    await paragraph.click();
    await paragraph.evaluate((node) => {
      const text = document.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode();
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 7);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.waitForTimeout(300);
    report.checks.editorSelectionButtons = await page.getByRole('button').allTextContents();
    await capture('editor-selection-390');
    await page.keyboard.press('Tab');
    report.checks.editorFirstTab = await page.evaluate(() => ({
      label: document.activeElement?.getAttribute('aria-label'),
      role: document.activeElement?.getAttribute('role'),
      selected: window.getSelection()?.toString(),
    }));
    await capture('editor-selection-tab-390');
    await paragraph.focus();
    await page.keyboard.press('Shift+Tab');
    report.checks.editorShiftTab = await page.evaluate(() => ({
      label: document.activeElement?.getAttribute('aria-label'),
      role: document.activeElement?.getAttribute('role'),
      selected: window.getSelection()?.toString(),
    }));
    report.checks.editorLinkButtonsAfterShiftTab = await page
      .getByRole('button', { name: 'Link', exact: true })
      .count();
    await capture('editor-selection-shift-tab-390');
    const blank = new Y.Doc();
    writeDocument(blank, { root: [], blocks: {} });
    await page.evaluate(
      async ({ pageId, update }) => {
        await new Promise((resolve, reject) => {
          const request = indexedDB.open('nilo-documents', 1);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(['updates', 'pages'], 'readwrite');
            tx.objectStore('updates').clear();
            tx.objectStore('updates').add({ pageId, data: new Uint8Array(update) });
            tx.objectStore('pages').put({ pageId, dirty: false });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
          request.onerror = () => reject(request.error);
        });
      },
      { pageId: pageData.id, update: [...Y.encodeStateAsUpdate(blank)] },
    );
    await page.reload();
    await page
      .getByRole('textbox', { name: 'Title', exact: true })
      .waitFor({ timeout: 10000 })
      .catch(() => {});
    await page.waitForTimeout(1000);
    await capture('document-empty-390');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    await capture('document-empty-1440');
  }
  report.status =
    report.errors.length || report.unexpected.length ? 'captured with exceptions' : 'captured';
} catch (error) {
  report.status = 'incomplete';
  report.failure = error.message;
  await capture('failure');
  process.exitCode = 1;
} finally {
  writeFileSync(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({
      status: report.status,
      frames: report.frames.length,
      errors: report.errors,
      unexpected: report.unexpected,
      failure: report.failure,
    }),
  );
  await browser.close();
}
