import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Select } from '@oxy.so/bloom/select';
import { SegmentedControl } from '@oxy.so/bloom/segmented-control';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { CommentPanel } from '../comment-panel';
import { CommentThread } from '../comment-thread';
import { CommentComposer } from '../comment-composer';
import type { Comment } from '@/lib/types/comments';

const mockQuery = jest.fn();
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ user: null }) }));
jest.mock('@/lib/api/client', () => ({ __esModule: true, default: {} }));
jest.mock('@/lib/hooks/use-comments', () => ({
  ...jest.requireActual('@/lib/hooks/use-comments'),
  usePageComments: (...args: unknown[]) => mockQuery(...args),
  useCreateComment: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock('@/lib/hooks/use-member-profiles', () => ({
  useMemberProfiles: () => ({ data: [{ id: 'ana', name: 'Ana' }] }),
  profileName: (profile?: { name: string }) => profile?.name,
}));
jest.mock('@/lib/realtime/use-live-updates', () => ({ useCommentsLive: () => {} }));
jest.mock('../comment-thread', () => ({ CommentThread: () => null }));
jest.mock('../comment-composer', () => ({ CommentComposer: () => null }));
jest.mock('../comment-quote', () => ({ CommentQuote: () => null }));

const comment = (id: string, overrides: Partial<Comment> = {}): Comment =>
  ({
    id,
    authorId: 'owner',
    blockId: 'block',
    parentCommentId: null,
    createdAt: '2026-10-20T12:00:00Z',
    resolvedAt: null,
    ...overrides,
  }) as Comment;
let renderer: ReactTestRenderer;
const ids = () =>
  renderer.root.findAllByType(CommentThread).map((node) => node.props.thread.root.id);
afterEach(() => act(() => renderer.unmount()));

it('combines status, block and participant filters without losing matching replies', () => {
  mockQuery.mockReturnValue({
    data: {
      comments: [
        comment('open'),
        comment('reply', { parentCommentId: 'open', authorId: 'ana' }),
        comment('resolved', { authorId: 'ana', resolvedAt: '2026-10-20T12:01:00Z' }),
        comment('other-block', { authorId: 'ana', blockId: 'other' }),
      ],
    },
    isLoading: false,
  });
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <CommentPanel
          pageId="page"
          workspaceId="workspace"
          open
          focusedBlockId="block"
          canComment={false}
          onClose={jest.fn()}
        />
      </BloomTestProviders>,
    );
  });
  expect(mockQuery).toHaveBeenCalledWith('page', true);
  expect(ids()).toEqual(['open']);
  expect(renderer.root.findAllByType(CommentComposer)).toHaveLength(0);
  act(() => renderer.root.findByType(Select).props.onValueChange('ana'));
  expect(ids()).toEqual(['open']);
  act(() => renderer.root.findByType(SegmentedControl).props.onValueChange('resolved'));
  expect(ids()).toEqual(['resolved']);
  act(() => renderer.root.findByType(Select).props.onValueChange('owner'));
  expect(ids()).toEqual([]);
  expect(JSON.stringify(renderer.toJSON())).toContain('comments.panel.emptyPerson');
  act(() => renderer.root.findByType(SegmentedControl).props.onValueChange('all'));
  expect(ids()).toEqual(['open']);
});
