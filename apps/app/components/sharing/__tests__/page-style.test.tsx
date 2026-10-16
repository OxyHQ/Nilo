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
jest.mock('@oxy.so/bloom/fonts', () => ({
  fontFamilies: { sans: 'Inter', display: 'BlomusModernus', mono: 'JetBrains Mono' },
}));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));
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
