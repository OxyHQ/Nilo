/**
 * Recents on every device: the server keeps when the user last opened each
 * page (`POST /pages/:id/visit`, `GET /pages/recent`), and this device keeps
 * its own list (`ui-store`'s `recentPageIds`) for when the server cannot be
 * reached.
 */

/** A page counts as visited once it has stayed open this long. */
export const VISIT_DELAY_MS = 1500;
/** The same page is recorded again at most this often. */
export const VISIT_INTERVAL_MS = 60_000;

export interface VisitRecorder {
  /** The page shown now; the previous one, if still waiting, is not recorded. */
  open: (pageId: string) => void;
  /** Nothing shown: a waiting visit is dropped. */
  close: () => void;
}

/**
 * Debounces visits: a page is sent once it has stayed open `delayMs` (paging
 * through pages records only where the user stops), and not again within
 * `intervalMs`. A failed send is forgotten, so the next open tries again.
 */
export function createVisitRecorder({
  send,
  delayMs = VISIT_DELAY_MS,
  intervalMs = VISIT_INTERVAL_MS,
  now = () => Date.now(),
}: {
  send: (pageId: string) => Promise<unknown>;
  delayMs?: number;
  intervalMs?: number;
  now?: () => number;
}): VisitRecorder {
  const sentAt = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const close = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return {
    close,
    open: (pageId) => {
      close();
      const last = sentAt.get(pageId);
      if (last !== undefined && now() - last < intervalMs) return;
      timer = setTimeout(() => {
        timer = null;
        sentAt.set(pageId, now());
        send(pageId).catch(() => sentAt.delete(pageId));
      }, delayMs);
    },
  };
}

/**
 * The recent page ids to show: the server's (every device's visits) when it
 * answered, else this device's own. The pages the server no longer lists are
 * ones the user cannot open any more, so the device list does not add them
 * back.
 */
export function recentPageIds(
  server: readonly string[] | undefined,
  device: readonly string[],
): readonly string[] {
  return server ?? device;
}
