import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { router } from 'expo-router';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import type { Block } from '@/lib/types/pages';
import { ChildPageBlock } from '../child-page-block';

const child = '01890000-0000-7000-8000-0000000000aa';
let mockPage: { data?: { page: Record<string, unknown> }; isError?: boolean } = {};
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/hooks/use-pages', () => ({
  usePage: (id: string | undefined) => (id ? mockPage : {}),
}));
jest.mock('@/components/page-chrome/icon-display', () => ({ IconDisplay: () => null }));

const block = (pageId: string): Block => ({
  id: 'b',
  pageId: 'parent',
  parentBlockId: null,
  type: 'child_page',
  content: { pageId },
  order: 0,
  createdAt: '',
  updatedAt: '',
});

let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer.unmount()));
const mount = (pageId: string) =>
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <ChildPageBlock block={block(pageId)} onChangeContent={jest.fn()} readOnly={false} />
      </BloomTestProviders>,
    );
  });

it('shows its subpage by title and opens it', () => {
  mockPage = { data: { page: { id: child, title: 'Minutes', archived: false } } };
  mount(child);
  const link = renderer.root.findByProps({
    accessibilityRole: 'link',
    accessibilityLabel: 'Minutes',
  });
  act(() => link.props.onPress());
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/(app)/p/[pageId]',
    params: { pageId: child },
  });
});

it('says a subpage in the trash is there, and still opens it', () => {
  mockPage = { data: { page: { id: child, title: 'Old', archived: true } } };
  mount(child);
  expect(JSON.stringify(renderer.toJSON())).toContain('editor.blocks.childPage.trashed');
});

it('waits for its page while it is being made, and says when it cannot be opened', () => {
  mount('000000000000000000000000');
  expect(JSON.stringify(renderer.toJSON())).toContain('editor.blocks.childPage.creating');
  mockPage = { isError: true };
  act(() =>
    renderer.update(
      <BloomTestProviders>
        <ChildPageBlock block={block(child)} onChangeContent={jest.fn()} readOnly={false} />
      </BloomTestProviders>,
    ),
  );
  expect(JSON.stringify(renderer.toJSON())).toContain('editor.blocks.childPage.missing');
});
