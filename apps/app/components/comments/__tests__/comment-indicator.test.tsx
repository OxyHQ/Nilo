import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import {
  BlockCommentMarker,
  BlockCommentsProvider,
  CommentIndicator,
  openCommentCounts,
} from '../comment-indicator';

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => `${key}:${options?.count ?? ''}`,
  }),
}));

const comment = (
  blockId: string | null,
  parentCommentId: string | null,
  resolvedAt: string | null,
) => ({
  blockId,
  parentCommentId,
  resolvedAt,
});

it('counts the open threads on each block, not replies, resolved threads or page comments', () => {
  const counts = openCommentCounts([
    comment('a', null, null),
    comment('a', null, null),
    comment('a', 'thread', null),
    comment('b', null, '2026-10-19T10:00:00Z'),
    comment(null, null, null),
    comment('c', null, null),
  ]);
  expect([...counts]).toEqual([
    ['a', 2],
    ['c', 1],
  ]);
});

describe('a block comment marker', () => {
  let renderer: ReactTestRenderer;
  afterEach(() => act(() => renderer.unmount()));

  it('shows the count of a block with open threads and opens the panel on that block', () => {
    const open = jest.fn();
    act(() => {
      renderer = create(
        <BloomTestProviders>
          <BlockCommentsProvider counts={new Map([['a', 3]])} open={open}>
            <BlockCommentMarker blockId="a" />
            <BlockCommentMarker blockId="b" />
          </BlockCommentsProvider>
        </BloomTestProviders>,
      );
    });
    const markers = renderer.root.findAllByType(CommentIndicator);
    expect(markers).toHaveLength(1);
    expect(markers[0]?.props.count).toBe(3);
    const button = renderer.root.findByProps({ accessibilityLabel: 'comments.indicator.count:3' });
    act(() => button.props.onPress());
    expect(open).toHaveBeenCalledWith('a');
  });

  it('draws nothing outside a page whose comments are shown', () => {
    act(() => {
      renderer = create(
        <BloomTestProviders>
          <BlockCommentMarker blockId="a" />
        </BloomTestProviders>,
      );
    });
    expect(renderer.root.findAllByType(CommentIndicator)).toHaveLength(0);
  });
});
