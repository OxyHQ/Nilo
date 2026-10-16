/**
 * Pages kept on the device to open without a connection, as Notion does:
 * each one for a reason — the member chose it (`pinned`), or opened it lately
 * (`recent`, the last {@link MAX_RECENT}) — and dropped once it has none left.
 *
 * What is kept of a page is its document, in the device's document store
 * (`doc-store.ts`), which the editing session keeps current as the page
 * changes. This index says which pages are kept and why; a page holding work
 * the server has not confirmed stays in the store whatever the index says.
 */
import { pageDocStore } from './doc-store';
import type { PageDocStore } from './doc-store-types';
import { type OfflineFiles, offlineFiles } from './offline-files';

export type OfflineReason = 'pinned' | 'recent';

/** How many recently opened pages stay on the device. */
export const MAX_RECENT = 20;

export interface OfflineEntry {
  pageId: string;
  reasons: OfflineReason[];
  /** When it was last opened (ms since the epoch). */
  openedAt: number;
  /** When its document was last stored; null while there is none. */
  savedAt: number | null;
  /** The stored document's size in bytes. */
  bytes: number;
  title: string | null;
  workspaceId: string | null;
}

interface Index {
  pages: Record<string, OfflineEntry>;
}

const INDEX = 'index.json';

export class OfflinePages {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly files: OfflineFiles | null,
    private readonly docs: PageDocStore | null,
    private readonly now: () => number = Date.now,
  ) {}

  /** Whether this device keeps pages offline (not in a browser). */
  get supported(): boolean {
    return this.files !== null;
  }

  /** Called whenever what is kept changes. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** One change at a time: the index is read, changed and written whole. */
  private serial<T>(work: (files: OfflineFiles) => Promise<T>): Promise<T | null> {
    const files = this.files;
    if (!files) return Promise.resolve(null);
    const run = this.queue.then(() => work(files));
    this.queue = run.catch(() => undefined);
    return run.catch(() => null);
  }

  private async readIndex(files: OfflineFiles): Promise<Index> {
    try {
      const raw = await files.read(INDEX);
      const parsed = raw ? (JSON.parse(raw) as Index) : null;
      return parsed?.pages ? parsed : { pages: {} };
    } catch {
      return { pages: {} };
    }
  }

  private async writeIndex(files: OfflineFiles, index: Index): Promise<void> {
    await files.write(INDEX, JSON.stringify(index));
    for (const listener of this.listeners) listener();
  }

  /** Drop the copies with no reason left, and recent ones past the limit. */
  private async prune(files: OfflineFiles, index: Index): Promise<void> {
    const recent = Object.values(index.pages)
      .filter((entry) => entry.reasons.includes('recent'))
      .sort((a, b) => b.openedAt - a.openedAt);
    for (const entry of recent.slice(MAX_RECENT)) {
      entry.reasons = entry.reasons.filter((reason) => reason !== 'recent');
    }
    for (const entry of Object.values(index.pages)) {
      if (entry.reasons.length > 0) continue;
      delete index.pages[entry.pageId];
      await this.docs?.remove(entry.pageId);
    }
  }

  private entry(index: Index, pageId: string): OfflineEntry {
    index.pages[pageId] ??= {
      pageId,
      reasons: [],
      openedAt: 0,
      savedAt: null,
      bytes: 0,
      title: null,
      workspaceId: null,
    };
    return index.pages[pageId];
  }

  /** The page was opened: it is kept as a recent one. */
  async opened(pageId: string): Promise<void> {
    await this.serial(async (files) => {
      const index = await this.readIndex(files);
      const entry = this.entry(index, pageId);
      entry.openedAt = this.now();
      if (!entry.reasons.includes('recent')) entry.reasons.push('recent');
      await this.prune(files, index);
      await this.writeIndex(files, index);
    });
  }

  /** Keep the page offline because the member chose to, or stop. */
  async setPinned(pageId: string, pinned: boolean): Promise<void> {
    await this.serial(async (files) => {
      const index = await this.readIndex(files);
      const entry = this.entry(index, pageId);
      entry.reasons = entry.reasons.filter((reason) => reason !== 'pinned');
      if (pinned) entry.reasons.push('pinned');
      await this.prune(files, index);
      await this.writeIndex(files, index);
    });
  }

  /** What a list of offline pages shows; kept only for a page already kept. */
  async describe(pageId: string, about: { title: string; workspaceId: string }): Promise<void> {
    await this.serial(async (files) => {
      const index = await this.readIndex(files);
      const entry = index.pages[pageId];
      if (!entry || (entry.title === about.title && entry.workspaceId === about.workspaceId)) {
        return;
      }
      entry.title = about.title;
      entry.workspaceId = about.workspaceId;
      await this.writeIndex(files, index);
    });
  }

  /** The page's document was stored: when, and its size. Only for a page kept. */
  async saved(pageId: string, bytes: number): Promise<void> {
    await this.serial(async (files) => {
      const index = await this.readIndex(files);
      const entry = index.pages[pageId];
      if (!entry) return;
      entry.savedAt = this.now();
      entry.bytes = bytes;
      await this.writeIndex(files, index);
    });
  }

  /** Whether the page is kept for some reason. */
  async keeps(pageId: string): Promise<boolean> {
    const index = await this.serial((files) => this.readIndex(files));
    return (index?.pages[pageId]?.reasons.length ?? 0) > 0;
  }

  /** Every page kept, most recently opened first. */
  async list(): Promise<OfflineEntry[]> {
    const index = await this.serial((files) => this.readIndex(files));
    return Object.values(index?.pages ?? {}).sort((a, b) => b.openedAt - a.openedAt);
  }

  /**
   * Drop the page and its document whatever the reasons, unsent work
   * included: it is gone, or no longer the member's to read or write.
   */
  async forget(pageId: string): Promise<void> {
    await this.docs?.remove(pageId, { force: true });
    await this.serial(async (files) => {
      const index = await this.readIndex(files);
      if (!index.pages[pageId]) return;
      delete index.pages[pageId];
      await this.writeIndex(files, index);
    });
  }

  /** Forget every page kept on this device, and every document stored. */
  async clear(): Promise<void> {
    await this.docs?.clear();
    await this.serial(async (files) => {
      await files.clear();
      for (const listener of this.listeners) listener();
    });
  }
}

/** This device's offline pages. */
export const offlinePages = new OfflinePages(offlineFiles, offlineFiles ? pageDocStore : null);
