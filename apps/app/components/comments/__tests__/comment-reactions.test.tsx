import type React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
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
const mockPicker = { open: jest.fn(), close: jest.fn() };
jest.mock('@oxy.so/bloom/dialog', () => {
  const React = require('react');
  // The picker renders its body only after `control.open()`, as Bloom's does.
  return {
    useDialogControl: () => mockPicker,
    Dialog: ({ children }: { children: React.ReactNode }) => {
      const [open, setOpen] = React.useState(false);
      mockPicker.open.mockImplementation(() => setOpen(true));
      return open ? children : null;
    },
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
  // The outermost match: a Bloom Button or Chip and the pressable inside it carry the same label.
  return renderer.root.findAll(
    (node) => node.props.accessibilityLabel === label && node.props.onPress,
  )[0];
}
afterEach(() => {
  act(() => renderer.unmount());
  jest.clearAllMocks();
});
it('highlights own reactions, toggles add/remove, and shows profile names on hover and long press', () => {
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <CommentReactions comment={comment} canComment />
      </BloomTestProviders>,
    );
  });
  expect(action('comments.reactions.toggle 👍').props.selected).toBe(true);
  expect(action('comments.reactions.toggle 🎉').props.selected).toBe(false);
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
  expect(mockPicker.close).toHaveBeenCalled();
});
it('allows viewers to inspect names without mutating reactions', () => {
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <CommentReactions comment={comment} canComment={false} />
      </BloomTestProviders>,
    );
  });
  act(() => action('comments.reactions.toggle 👍').props.onPress());
  expect(mockMutate).not.toHaveBeenCalled();
  expect(
    renderer.root.findAll((node) => node.props.accessibilityLabel === 'comments.reactions.add'),
  ).toHaveLength(0);
  act(() => action('comments.reactions.toggle 👍').props.onLongPress());
  expect(JSON.stringify(renderer.toJSON())).toContain('Nate, Ana');
});
