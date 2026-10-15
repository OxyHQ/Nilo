import { isAxiosError } from 'axios';
import apiClient from '@/lib/api/client';
import { API_ROUTES } from '@/lib/api/routes';
import { type OfflinePages, offlinePages } from './offline-pages';
import type { BlocksResponse } from './use-page-editor';
import { blocksToDocument } from './wire';

/**
 * Bring the pages the member keeps offline up to date: each read again and its
 * copy replaced. A page that is gone or no longer theirs to read is dropped.
 * Stops at the first failure without an answer: the connection is gone again.
 */
export async function refreshPinnedPages(store: OfflinePages = offlinePages): Promise<void> {
  if (!store.supported) return;
  const pinned = (await store.list()).filter((entry) => entry.reasons.includes('pinned'));
  for (const entry of pinned) {
    try {
      const res = await apiClient.get<BlocksResponse>(API_ROUTES.pages.blocks(entry.pageId));
      const loaded = blocksToDocument(res.data.blocks, res.data.version);
      await store.save(entry.pageId, {
        version: res.data.version,
        base: loaded.doc,
        orders: loaded.orders.toJSON(),
      });
    } catch (err: unknown) {
      const status = isAxiosError(err) ? err.response?.status : undefined;
      if (status === 403 || status === 404) {
        await store.forget(entry.pageId);
        continue;
      }
      if (status === undefined) return;
    }
  }
}
