import { useNetworkStatus } from '@oxy.so/bloom/connection-status';
import { useOxy } from '@oxy.so/services/ui/client';
import { useCallback, useEffect, useState } from 'react';
import { type OfflineEntry, offlinePages } from './offline-pages';
import { refreshPinnedPages } from './offline-sync';

/** The offline pages, read again whenever what is kept changes. */
export function useOfflinePageList(): { supported: boolean; pages: OfflineEntry[] } {
  const [pages, setPages] = useState<OfflineEntry[]>([]);
  useEffect(() => {
    let live = true;
    const read = () => {
      void offlinePages.list().then((next) => {
        if (live) setPages(next);
      });
    };
    read();
    const stop = offlinePages.subscribe(read);
    return () => {
      live = false;
      stop();
    };
  }, []);
  return { supported: offlinePages.supported, pages };
}

/**
 * Whether the member keeps this page offline, and the switch for it. `about`
 * names the page in the list of offline pages.
 */
export function useOfflinePage(
  pageId: string,
  about?: { title: string; workspaceId: string },
): { supported: boolean; pinned: boolean; setPinned: (pinned: boolean) => Promise<void> } {
  const { pages } = useOfflinePageList();
  const entry = pages.find((page) => page.pageId === pageId);
  const title = about?.title;
  const workspaceId = about?.workspaceId;
  useEffect(() => {
    if (title !== undefined && workspaceId !== undefined) {
      void offlinePages.describe(pageId, { title, workspaceId });
    }
  }, [pageId, title, workspaceId]);
  const setPinned = useCallback(
    (pinned: boolean) => offlinePages.setPinned(pageId, pinned),
    [pageId],
  );
  return {
    supported: offlinePages.supported,
    pinned: entry?.reasons.includes('pinned') ?? false,
    setPinned,
  };
}

/**
 * Keeps the member's offline pages current: once signed in, and each time the
 * device comes back online. Mounted once, in the signed-in app.
 */
export function useOfflineSync(): void {
  const { isAuthenticated } = useOxy();
  const { online } = useNetworkStatus();
  useEffect(() => {
    if (isAuthenticated && online && offlinePages.supported) void refreshPinnedPages();
  }, [isAuthenticated, online]);
}
