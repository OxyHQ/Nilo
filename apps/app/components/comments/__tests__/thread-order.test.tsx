import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useThreadOrder } from '../use-thread-order';
import { commentThreadOrder, threadIncludesPerson } from '@/lib/comments/thread-order';
import type { CommentThread } from '@/lib/hooks/use-comments';
import type { Comment } from '@/lib/types/comments';

const comment = (id: string, minute: number, authorId = 'author'): Comment =>
  ({
    id,
    authorId,
    createdAt: new Date(Date.UTC(2026, 9, 20, 12, minute)).toISOString(),
  }) as Comment;
const thread = (id: string, minute: number, replies: Comment[] = []): CommentThread => ({
  root: comment(id, minute),
  replies,
});

it('orders initial threads by their latest reply without mutating input', () => {
  const threads = [thread('old', 1, [comment('reply', 8)]), thread('new', 5)];
  expect(commentThreadOrder(threads)).toEqual(['old', 'new']);
  expect(threads.map((item) => item.root.id)).toEqual(['old', 'new']);
  expect(commentThreadOrder([thread('b', 5), thread('a', 5)])).toEqual(['a', 'b']);
});

it('matches participants in replies as well as thread authors', () => {
  const item = thread('root', 1, [comment('reply', 2, 'teammate')]);
  expect(threadIncludesPerson(item, 'author')).toBe(true);
  expect(threadIncludesPerson(item, 'teammate')).toBe(true);
  expect(threadIncludesPerson(item, 'unrelated')).toBe(false);
});

it('keeps live updates stable, resets on reopening/page changes, and retains filtered order', () => {
  let renderer: ReactTestRenderer;
  let ordered: string[] = [];
  function Pane({
    threads,
    open,
    pageId = 'page',
  }: {
    threads: CommentThread[];
    open: boolean;
    pageId?: string;
  }) {
    ordered = useThreadOrder(threads, pageId, open).map((item) => item.root.id);
    return null;
  }
  const first = [thread('a', 1), thread('b', 2)];
  act(() => {
    renderer = create(<Pane threads={first} open />);
  });
  expect(ordered).toEqual(['b', 'a']);
  const updated = [thread('a', 1, [comment('reply', 9)]), thread('b', 2), thread('c', 10)];
  act(() => renderer.update(<Pane threads={updated} open />));
  expect(ordered).toEqual(['b', 'a', 'c']);
  act(() => renderer.update(<Pane threads={updated.slice(0, 1)} open />));
  expect(ordered).toEqual(['a']);
  act(() => renderer.update(<Pane threads={updated} open />));
  expect(ordered).toEqual(['b', 'a', 'c']);
  act(() => renderer.update(<Pane threads={updated} open={false} />));
  act(() => renderer.update(<Pane threads={updated} open />));
  expect(ordered).toEqual(['c', 'a', 'b']);
  act(() => renderer.update(<Pane threads={first} pageId="other" open />));
  expect(ordered).toEqual(['b', 'a']);
  act(() => renderer.unmount());
});
