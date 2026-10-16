import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, Text as RNText, View } from 'react-native';
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
jest.mock('@oxy.so/bloom/fonts', () => ({
  fontFamilies: { sans: 'Inter', display: 'BlomusModernus', mono: 'JetBrains Mono' },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
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
it('applies published font and width, ignoring small text and locking', () => {
  mockFullWidth = true;
  act(() => {
    renderer = create(<PublicSitePage />);
  });
  const title = renderer.root
    .findAllByType(RNText)
    .find((node) => node.props.children === 'Published title')!;
  expect(StyleSheet.flatten(title.props.style).fontFamily).toBe('BlomusModernus');
  expect(title.props.className).toContain('text-3xl');
  expect(renderer.root.findByType(SharedBlockTree).props.font).toBe('serif');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('pages.lock');
  expect(
    renderer.root.findAllByType(View).some((node) => node.props.className?.includes('max-w-3xl')),
  ).toBe(false);
  mockFullWidth = false;
  act(() => renderer.update(<PublicSitePage />));
  expect(
    renderer.root.findAllByType(View).some((node) => node.props.className?.includes('max-w-3xl')),
  ).toBe(true);
});
it('uses the page face throughout shared text while preserving the code face', () => {
  act(() => {
    renderer = create(<SharedBlockTree blocks={blocks} font="serif" />);
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
      renderer = create(<SharedBlockTree blocks={toggleBlocks} publicSlug={publicSlug} />);
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
