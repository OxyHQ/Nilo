import type React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { CommentReactions } from '../comment-reactions';
import type { Comment } from '@/lib/types/comments';
const mockMutate = jest.fn();
jest.mock('@oxy.so/services', () => ({ useOxy: () => ({ user: { id: 'me' } }) }));
jest.mock('@tanstack/react-query', () => ({ useIsMutating: () => 0 }));
jest.mock('@/lib/hooks/use-comments', () => ({
  useCommentReaction: () => ({ mutate: mockMutate }),
}));
jest.mock('@/lib/hooks/use-member-profiles', () => ({
  useMemberProfiles: () => ({
    data: [
      { id: 'me', name: 'Nate' },
      { id: 'other', name: 'Ana' },
    ],
  }),
  profileName: (profile?: { name: string }) => profile?.name,
}));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { emoji: string }) =>
      params?.emoji ? `${key} ${params.emoji}` : key,
  }),
}));
jest.mock('@/components/ui/dialog', () => {
  const { View } = require('react-native');
  return {
    Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
      open ? children : null,
    DialogContent: View,
    DialogTitle: View,
  };
});
const comment = {
  id: 'c',
  reactions: [
    { emoji: '👍', userIds: ['me', 'other'] },
    { emoji: '🎉', userIds: ['other'] },
  ],
} as Comment;
let renderer: ReactTestRenderer;
function action(label: string) {
  return renderer.root.find(
    (node) => node.props.accessibilityLabel === label && node.props.onPress,
  );
}
afterEach(() => {
  act(() => renderer.unmount());
  jest.clearAllMocks();
});
it('highlights own reactions, toggles add/remove, and shows profile names on hover and long press', () => {
  act(() => {
    renderer = create(<CommentReactions comment={comment} canComment />);
  });
  expect(action('comments.reactions.toggle 👍').props.accessibilityState.selected).toBe(true);
  act(() => action('comments.reactions.toggle 👍').props.onPress());
  expect(mockMutate).toHaveBeenLastCalledWith({ comment, emoji: '👍', remove: true });
  act(() => action('comments.reactions.toggle 🎉').props.onPress());
  expect(mockMutate).toHaveBeenLastCalledWith({ comment, emoji: '🎉', remove: false });
  act(() => action('comments.reactions.toggle 👍').props.onHoverIn());
  expect(JSON.stringify(renderer.toJSON())).toContain('Nate, Ana');
  act(() => action('comments.reactions.toggle 👍').props.onHoverOut());
  act(() => action('comments.reactions.toggle 🎉').props.onLongPress());
  expect(JSON.stringify(renderer.toJSON())).toContain('Ana');
  act(() => action('comments.reactions.add').props.onPress());
  act(() => action('comments.reactions.choose ❤️').props.onPress());
  expect(mockMutate).toHaveBeenLastCalledWith({ comment, emoji: '❤️', remove: false });
});
it('allows viewers to inspect names without mutating reactions', () => {
  act(() => {
    renderer = create(<CommentReactions comment={comment} canComment={false} />);
  });
  act(() => action('comments.reactions.toggle 👍').props.onPress());
  expect(mockMutate).not.toHaveBeenCalled();
  expect(
    renderer.root.findAll((node) => node.props.accessibilityLabel === 'comments.reactions.add'),
  ).toHaveLength(0);
  act(() => action('comments.reactions.toggle 👍').props.onLongPress());
  expect(JSON.stringify(renderer.toJSON())).toContain('Nate, Ana');
});
