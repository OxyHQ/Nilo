import { isAxiosError } from 'axios';
import * as Y from 'yjs';
import apiClient from '@/lib/api/client';
import { API_ROUTES } from '@/lib/api/routes';
import { fromBase64, toBase64 } from './base64';
import { pageDocStore } from './doc-store';
import type { PageDocStore } from './doc-store-types';
import { type OfflinePages, offlinePages } from './offline-pages';

/**
 * Bring the pages the member keeps offline up to date: for each, what the
 * server has beyond what the device holds is fetched and stored. A page that
 * is gone or no longer theirs to read is dropped. Stops at the first failure
 * without an answer: the connection is gone again.
 */
export async function refreshPinnedPages(
  pages: OfflinePages = offlinePages,
  docs: PageDocStore | null = pageDocStore,
): Promise<void> {
  if (!pages.supported || !docs) return;
  const pinned = (await pages.list()).filter((entry) => entry.reasons.includes('pinned'));
  for (const entry of pinned) {
    try {
      const doc = new Y.Doc();
      const kept = await docs.load(entry.pageId);
      if (kept) Y.applyUpdate(doc, Y.mergeUpdates(kept.updates));
      const res = await apiClient.post<{ update: string }>(API_ROUTES.pages.doc(entry.pageId), {
        stateVector: toBase64(Y.encodeStateVector(doc)),
      });
      const update = fromBase64(res.data.update);
      Y.applyUpdate(doc, update);
      await docs.append(entry.pageId, update, false);
      await pages.saved(entry.pageId, Y.encodeStateAsUpdate(doc).byteLength);
      doc.destroy();
    } catch (err: unknown) {
      const status = isAxiosError(err) ? err.response?.status : undefined;
      if (status === 403 || status === 404) {
        await pages.forget(entry.pageId);
        continue;
      }
      if (status === undefined) return;
    }
  }
}
