/**
 * Pages kept on the device to open without a connection, as Notion does:
 * each one for a reason — the member chose it (`pinned`), or opened it lately
 * (`recent`, the last {@link MAX_RECENT}) — and dropped once it has none left.
 *
 * A copy is a whole page the server confirmed (its blocks at one version,
 * never part of one), replaced as the page changes. Work not yet confirmed is
 * kept apart, in `offline.ts`, and sent when the connection is back.
 */
import type { BlockId, EditorDocument } from '@oxy.so/bloom-editor/model';
import { type OfflineFiles, offlineFiles } from './offline-files';

export type OfflineReason = 'pinned' | 'recent';

/** How many recently opened pages stay on the device. */
export const MAX_RECENT = 20;

export interface OfflineCopy {
  version: number;
  base: EditorDocument;
  orders: [BlockId, number, number, number?][];
}

export interface OfflineEntry {
  pageId: string;
  reasons: OfflineReason[];
  /** When it was last opened (ms since the epoch). */
  openedAt: number;
  /** When its copy was last written; null while there is none. */
  savedAt: number | null;
  /** The copy's size in bytes. */
  bytes: number;
  title: string | null;
  workspaceId: string | null;
}

interface Index {
  pages: Record<string, OfflineEntry>;
}

const INDEX = 'index.json';
const copyName = (pageId: string) => `${pageId}.json`;

export class OfflinePages {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly files: OfflineFiles | null,
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
      await files.remove(copyName(entry.pageId));
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

  /** Replace the page's copy, if the page is kept; an older version never replaces a newer. */
  async save(pageId: string, copy: OfflineCopy): Promise<void> {
    await this.serial(async (files) => {
      const index = await this.readIndex(files);
      const entry = index.pages[pageId];
      if (!entry) return;
      const current = await this.readCopyFrom(files, pageId);
      if (current && current.version > copy.version) return;
      const text = JSON.stringify(copy);
      await files.write(copyName(pageId), text);
      entry.savedAt = this.now();
      entry.bytes = new TextEncoder().encode(text).length;
      await this.writeIndex(files, index);
    });
  }

  private async readCopyFrom(files: OfflineFiles, pageId: string): Promise<OfflineCopy | null> {
    try {
      const raw = await files.read(copyName(pageId));
      return raw ? (JSON.parse(raw) as OfflineCopy) : null;
    } catch {
      // An unreadable copy is no copy: the page opens online or not at all.
      return null;
    }
  }

  /** The page's copy, or null. */
  async read(pageId: string): Promise<OfflineCopy | null> {
    return this.serial((files) => this.readCopyFrom(files, pageId));
  }

  /** Every page kept, most recently opened first. */
  async list(): Promise<OfflineEntry[]> {
    const index = await this.serial((files) => this.readIndex(files));
    return Object.values(index?.pages ?? {}).sort((a, b) => b.openedAt - a.openedAt);
  }

  /** Drop the page and its copy whatever the reasons: it is gone, or no longer the member's to read. */
  async forget(pageId: string): Promise<void> {
    await this.serial(async (files) => {
      const index = await this.readIndex(files);
      if (!index.pages[pageId]) return;
      delete index.pages[pageId];
      await files.remove(copyName(pageId));
      await this.writeIndex(files, index);
    });
  }

  /** Forget every page kept on this device. */
  async clear(): Promise<void> {
    await this.serial(async (files) => {
      await files.clear();
      for (const listener of this.listeners) listener();
    });
  }
}

/** This device's offline pages. */
export const offlinePages = new OfflinePages(offlineFiles);
