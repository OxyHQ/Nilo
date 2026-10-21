import { useEffect, useMemo, useState } from 'react';
import type { CommentThread } from '@/lib/hooks/use-comments';
import { commentThreadOrder } from '@/lib/comments/thread-order';

/** Each opening/page starts a fresh order; filters and realtime updates preserve it. */
export function useThreadOrder(threads: CommentThread[], pageId: string, open: boolean) {
  const [session, setSession] = useState<{ pageId: string; ids: string[] } | null>(null);
  const ids = useMemo(
    () => commentThreadOrder(threads, open && session?.pageId === pageId ? session.ids : []),
    [threads, pageId, open, session],
  );
  useEffect(() => {
    if (!open) {
      setSession(null);
      return;
    }
    setSession((previous) =>
      previous?.pageId === pageId &&
      previous.ids.length === ids.length &&
      previous.ids.every((id, index) => id === ids[index])
        ? previous
        : { pageId, ids },
    );
  }, [open, pageId, ids]);
  return useMemo(() => {
    const byId = new Map(threads.map((thread) => [thread.root.id, thread]));
    return ids.flatMap((id) => {
      const thread = byId.get(id);
      return thread ? [thread] : [];
    });
  }, [threads, ids]);
}
