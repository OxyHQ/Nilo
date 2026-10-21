import type { CommentThread } from '../hooks/use-comments';

/** Latest reply first when opening a pane; live replies must not move existing threads. */
export function commentThreadOrder(threads: CommentThread[], previous: string[] = []): string[] {
  const known = new Set(previous);
  const latest = (thread: CommentThread) =>
    Math.max(
      Date.parse(thread.root.createdAt),
      ...thread.replies.map((reply) => Date.parse(reply.createdAt)),
    );
  const added = threads
    .filter((thread) => !known.has(thread.root.id))
    .sort((a, b) => latest(b) - latest(a) || a.root.id.localeCompare(b.root.id))
    .map((thread) => thread.root.id);
  // Keep IDs of filtered or deleted threads for the lifetime of the pane. Refetches
  // and resolve/reopen must not move the reader's remaining conversations.
  return [...previous, ...added];
}

export function threadIncludesPerson(thread: CommentThread, authorId: string): boolean {
  return (
    thread.root.authorId === authorId || thread.replies.some((reply) => reply.authorId === authorId)
  );
}
