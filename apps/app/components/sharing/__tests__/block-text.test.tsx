import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Link } from 'expo-router';
import { BlockText, PublicMentionContext } from '../block-text';

jest.mock('expo-router', () => ({ Link: 'Link' }));
jest.mock('@/components/ui/text', () => ({ Text: 'Text' }));
jest.mock('@/components/page-editor/open-target', () => ({ openEditorLink: jest.fn() }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (_key: string, args: { title: string }) => `Open ${args.title}` }),
}));
let mockPublished = false;
jest.mock('@/lib/hooks/use-page-extras', () => ({
  usePublicPage: (_slug: string, id: string) => ({
    isError: !mockPublished,
    data: mockPublished ? { page: { id } } : undefined,
  }),
}));
const content = {
  text: 'stale mirror',
  segments: [
    { text: 'Meet ' },
    { text: 'José', mention: { indicator: '@', attributes: { kind: 'user', id: 'oxy-user' } } },
    { text: ' on ' },
    { text: 'Roadmap', mention: { indicator: '@', attributes: { kind: 'page', id: 'target' } } },
  ],
};
let renderer: ReactTestRenderer;
afterEach(() => {
  act(() => renderer.unmount());
});
it('renders labels, with a page link and no serialized mention attributes', () => {
  act(() => {
    renderer = create(<BlockText content={content} />);
  });
  const links = renderer.root.findAllByType(Link);
  expect(links).toHaveLength(1);
  expect(links[0].props.href).toEqual({
    pathname: '/(app)/p/[pageId]',
    params: { pageId: 'target' },
  });
  const rendered = JSON.stringify(renderer.toJSON());
  expect(rendered).toContain('José');
  expect(rendered).toContain('Roadmap');
  expect(rendered).not.toContain('attributes');
  expect(rendered).not.toContain('stale mirror');
});
it('only links public mentions after the anonymous endpoint confirms publication', () => {
  mockPublished = false;
  act(() => {
    renderer = create(
      <PublicMentionContext.Provider value="site">
        <BlockText content={content} />
      </PublicMentionContext.Provider>,
    );
  });
  expect(renderer.root.findAllByType(Link)).toHaveLength(0);
  mockPublished = true;
  act(() => {
    renderer.update(
      <PublicMentionContext.Provider value="site">
        <BlockText content={content} />
      </PublicMentionContext.Provider>,
    );
  });
  expect(renderer.root.findByType(Link).props.href).toEqual({
    pathname: '/pub/[slug]/[pageId]',
    params: { slug: 'site', pageId: 'target' },
  });
});
it('continues to render legacy plain-text blocks', () => {
  act(() => {
    renderer = create(<BlockText content={{ text: 'Legacy text' }} />);
  });
  expect(JSON.stringify(renderer.toJSON())).toContain('Legacy text');
});
it.each([undefined, 'site'])(
  'renders date mentions from canonical dates in previews and public pages (%s)',
  (slug) => {
    act(() => {
      renderer = create(
        <PublicMentionContext.Provider value={slug}>
          <BlockText
            content={{
              segments: [
                {
                  text: 'old label',
                  mention: { indicator: '@', attributes: { kind: 'date', date: '2026-10-17' } },
                },
              ],
            }}
          />
        </PublicMentionContext.Provider>,
      );
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('October 17, 2026');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('old label');
    expect(renderer.root.findAllByType(Link)).toHaveLength(0);
  },
);
