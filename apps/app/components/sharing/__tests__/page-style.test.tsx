import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ReactNode } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import PublicSitePage from '../public-site-page';
import { SharedBlockTree } from '../shared-block-renderer';

let mockFullWidth = true;
const blocks = [
  { id: 'text', parentBlockId: null, type: 'paragraph', content: { text: 'Body copy' }, order: 0 },
  { id: 'code', parentBlockId: null, type: 'code', content: { text: 'const x = 1' }, order: 1 },
];
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ slug: 'site' }),
  Link: require('react-native').View,
}));
jest.mock('expo-router/head', () => ({ __esModule: true, default: () => null }));
// Images and files ask the API for their URLs (`lib/files`); none render here.
jest.mock('@/lib/api/client', () => ({ __esModule: true, default: { post: jest.fn() } }));
// Video and audio blocks can be uploaded to, through the member's Oxy session.
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ oxyServices: {} }) }));
jest.mock('@oxy.so/bloom/fonts', () => ({
  fontFamilies: { sans: 'Inter', display: 'BlomusModernus', mono: 'JetBrains Mono' },
}));
jest.mock('@/components/page-chrome/cover-display', () => ({ CoverDisplay: () => null }));
jest.mock('@/components/page-chrome/icon-display', () => ({ IconDisplay: () => null }));
jest.mock('@/components/page-chrome/callout-icon', () => ({ CalloutIcon: () => null }));
jest.mock('@/components/page-editor/open-target', () => ({ openEditorLink: jest.fn() }));
jest.mock('@/lib/hooks/use-page-extras', () => ({
  usePublicPage: () => ({
    data: {
      page: {
        title: 'Published title',
        font: 'serif',
        fullWidth: mockFullWidth,
        smallText: true,
        locked: true,
      },
      blocks: [],
      children: [],
      breadcrumb: [],
      site: { allowIndexing: false },
    },
  }),
}));
let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer.unmount()));
const themed = (node: ReactNode) => <BloomTestProviders>{node}</BloomTestProviders>;
it('applies published font and width, ignoring small text and locking', () => {
  mockFullWidth = true;
  act(() => {
    renderer = create(themed(<PublicSitePage />));
  });
  const title = renderer.root
    .findAllByType(RNText)
    .find((node) => node.props.children === 'Published title')!;
  expect(StyleSheet.flatten(title.props.style).fontFamily).toBe('BlomusModernus');
  const heading = renderer.root.findAll(
    (node) => node.props.children === 'Published title' && node.props.className !== undefined,
  );
  expect(heading[0].props.className).toContain('text-3xl');
  expect(renderer.root.findByType(SharedBlockTree).props.font).toBe('serif');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('pages.lock');
  expect(
    renderer.root.findAllByType(View).some((node) => node.props.className?.includes('max-w-3xl')),
  ).toBe(false);
  mockFullWidth = false;
  act(() => renderer.update(themed(<PublicSitePage />)));
  expect(
    renderer.root.findAllByType(View).some((node) => node.props.className?.includes('max-w-3xl')),
  ).toBe(true);
});
it('uses the page face throughout shared text while preserving the code face', () => {
  act(() => {
    renderer = create(themed(<SharedBlockTree blocks={blocks} font="serif" />));
  });
  const texts = renderer.root.findAllByType(RNText);
  expect(
    texts.some((node) => StyleSheet.flatten(node.props.style)?.fontFamily === 'BlomusModernus'),
  ).toBe(true);
  const code = texts.find((node) => node.props.children === 'const x = 1')!;
  expect(StyleSheet.flatten(code.props.style).fontFamily).toBe('JetBrains Mono');
});
it.each([undefined, 'site'])(
  'folds toggle heading children while retaining a heading in previews and public pages (%s)',
  (publicSlug) => {
    const toggleBlocks = [
      {
        id: 'heading',
        parentBlockId: null,
        type: 'heading_2',
        order: 0,
        content: { text: 'Toggle title', toggleable: true, expanded: false },
      },
      {
        id: 'child',
        parentBlockId: 'heading',
        type: 'paragraph',
        order: 0,
        content: { text: 'Folded content' },
      },
    ];
    act(() => {
      renderer = create(themed(<SharedBlockTree blocks={toggleBlocks} publicSlug={publicSlug} />));
    });
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Folded content');
    expect(
      renderer.root.findAllByType(RNText).some((node) => node.props.accessibilityRole === 'header'),
    ).toBe(true);
    const disclosure = () =>
      renderer.root
        .findAllByProps({ accessibilityRole: 'button' })
        .find((node) => node.props.accessibilityState?.expanded !== undefined)!;
    expect(disclosure().props.accessibilityState.expanded).toBe(false);
    act(() => disclosure().props.onPress());
    expect(disclosure().props.accessibilityState.expanded).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain('Folded content');
    act(() => disclosure().props.onPress());
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Folded content');
  },
);
it('lays out tables and columns and shows every kind of block, none as unsupported', () => {
  const block = (
    id: string,
    type: string,
    parentBlockId: string | null,
    content = {},
    order = 0,
  ) => ({
    id,
    parentBlockId,
    type,
    content,
    order,
  });
  const page = [
    block('h', 'heading_1', null, { text: 'Top' }, 0),
    block('toc', 'table_of_contents', null, {}, 1),
    block('t', 'table', null, { withHeader: true }, 2),
    block('r1', 'table_row', 't', {}, 0),
    block('c11', 'table_cell', 'r1', { text: 'Head A' }, 0),
    block('c12', 'table_cell', 'r1', { text: 'Head B' }, 1),
    block('r2', 'table_row', 't', {}, 1),
    block('c21', 'table_cell', 'r2', { text: 'Cell A' }, 0),
    block('cols', 'columns', null, {}, 3),
    block('col1', 'column', 'cols', {}, 0),
    block('left', 'paragraph', 'col1', { text: 'Left side' }, 0),
    block('col2', 'column', 'cols', {}, 1),
    block('right', 'paragraph', 'col2', { text: 'Right side' }, 0),
    block('eq', 'equation', null, { latex: 'x^2' }, 4),
    block(
      'btn',
      'button',
      null,
      { label: 'Go', action: 'navigate', url: 'https://example.com' },
      5,
    ),
    block('crumb', 'breadcrumb', null, {}, 6),
  ];
  act(() => {
    renderer = create(themed(<SharedBlockTree blocks={page} />));
  });
  const json = JSON.stringify(renderer.toJSON());
  for (const text of ['Head A', 'Head B', 'Cell A', 'Left side', 'Right side', 'Go', 'x^2']) {
    expect(json).toContain(text);
  }
  expect(json).not.toContain('sharing.blocks.unsupported');
  // The table of contents names the page's headings.
  expect(json.split('Top').length).toBeGreaterThan(2);
});

it('reads a synced block as what it shows: its own blocks, or its original’s as sent', () => {
  const tree = [
    { id: 'orig', parentBlockId: null, type: 'sync_block', content: {}, order: 0 },
    {
      id: 'mine',
      parentBlockId: 'orig',
      type: 'paragraph',
      content: { text: 'Own words' },
      order: 0,
    },
    {
      id: 'ref',
      parentBlockId: null,
      type: 'sync_block',
      content: { sourceBlockId: 'far', sourcePageId: 'other' },
      order: 1,
    },
    {
      id: 'hidden',
      parentBlockId: null,
      type: 'sync_block',
      content: { sourceBlockId: 'secret', sourcePageId: 'other' },
      order: 2,
    },
  ];
  const synced = {
    far: [
      {
        id: 'f1',
        parentBlockId: 'far',
        type: 'paragraph',
        content: { text: 'From afar' },
        order: 0,
      },
      // A reference to its own original inside what it shows: drawn once.
      {
        id: 'f2',
        parentBlockId: 'far',
        type: 'sync_block',
        content: { sourceBlockId: 'far', sourcePageId: 'other' },
        order: 1,
      },
    ],
  };
  act(() => {
    renderer = create(themed(<SharedBlockTree blocks={tree} synced={synced} />));
  });
  const json = JSON.stringify(renderer.toJSON());
  expect(json.split('Own words')).toHaveLength(2);
  expect(json.split('From afar')).toHaveLength(2);
});
