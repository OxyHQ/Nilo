import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@/lib/api/client';
import { useCommentReaction } from '../use-comments';
import type { Comment, CommentsListResponse } from '@/lib/types/comments';

jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ user: { id: 'me' } }) }));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { put: jest.fn(), delete: jest.fn() },
}));
const comment: Comment = {
  id: 'c',
  pageId: 'p',
  blockId: 'b',
  workspaceId: 'w',
  parentCommentId: null,
  authorId: 'other',
  content: { segments: [], plainText: '' },
  reactions: [{ emoji: '👍', userIds: ['other'] }],
  resolvedAt: null,
  editedAt: null,
  createdAt: '',
  updatedAt: '',
};
const keys = [
  ['comments', 'page', 'p', false],
  ['comments', 'page', 'p', true],
  ['comments', 'block', 'b'],
];
let client: QueryClient;
let renderer: ReactTestRenderer;
let mutation: ReturnType<typeof useCommentReaction>;
function Hook() {
  mutation = useCommentReaction();
  return null;
}
beforeEach(async () => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: Infinity } } });
  for (const key of keys) client.setQueryData(key, { comments: [comment] });
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <Hook />
      </QueryClientProvider>,
    );
  });
});
afterEach(() => {
  act(() => renderer.unmount());
  client.clear();
});
it('optimistically adds the caller, encodes emoji, and rolls back every cache on failure', async () => {
  let reject!: (error: Error) => void;
  jest.mocked(apiClient.put).mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  let request!: Promise<unknown>;
  await act(async () => {
    request = mutation.mutateAsync({ comment, emoji: '👍', remove: false }).catch(() => undefined);
  });
  expect(apiClient.put).toHaveBeenCalledWith('/comments/c/reactions/%F0%9F%91%8D');
  for (const key of keys)
    expect(client.getQueryData<CommentsListResponse>(key)?.comments[0].reactions).toEqual([
      { emoji: '👍', userIds: ['other', 'me'] },
    ]);
  await act(async () => {
    reject(new Error('offline'));
    await request;
  });
  for (const key of keys)
    expect(client.getQueryData<CommentsListResponse>(key)?.comments[0].reactions).toEqual(
      comment.reactions,
    );
});
it('removes only the caller and uses the server reaction order after success', async () => {
  const reacted = { ...comment, reactions: [{ emoji: '👍', userIds: ['me', 'other'] }] };
  for (const key of keys) client.setQueryData(key, { comments: [reacted] });
  jest.mocked(apiClient.delete).mockResolvedValue({ data: { reactions: comment.reactions } });
  await act(async () => {
    await mutation.mutateAsync({ comment: reacted, emoji: '👍', remove: true });
  });
  expect(apiClient.delete).toHaveBeenCalledWith('/comments/c/reactions/%F0%9F%91%8D');
  for (const key of keys)
    expect(client.getQueryData<CommentsListResponse>(key)?.comments[0].reactions).toEqual(
      comment.reactions,
    );
});
