/**
 * Where a page's document (`@oxy.so/bloom-editor/yjs`) lives on this device:
 * every update it took, in order, so a page opens without a connection and
 * work done offline is still there after the app is closed. SQLite on iOS
 * and Android (`doc-store.native.ts`), IndexedDB in a browser
 * (`doc-store.ts`).
 *
 * A page is `dirty` while it holds a change of this device's that the server
 * has not confirmed; nothing removes a dirty page but `clear`.
 */
export interface StoredPageDoc {
  updates: Uint8Array[];
  dirty: boolean;
}

export interface PageDocStore {
  /** Everything kept of the page, or null. */
  load(pageId: string): Promise<StoredPageDoc | null>;
  /** Keep one update; `local` when it is this device's own change. */
  append(pageId: string, update: Uint8Array, local: boolean): Promise<void>;
  /** The server has every change this device made to the page. */
  markSynced(pageId: string): Promise<void>;
  /** Replace the page's updates by one, their merge. */
  compact(pageId: string, state: Uint8Array): Promise<void>;
  isDirty(pageId: string): Promise<boolean>;
  /** Drop the page, unless it is dirty (`force` drops it all the same). */
  remove(pageId: string, options?: { force?: boolean }): Promise<void>;
  /** Drop everything: on sign-out, another account's pages never stay. */
  clear(): Promise<void>;
}

/** An in-memory store: for tests, and where a device keeps nothing. */
export class MemoryPageDocStore implements PageDocStore {
  private readonly pages = new Map<string, StoredPageDoc>();

  async load(pageId: string): Promise<StoredPageDoc | null> {
    const page = this.pages.get(pageId);
    return page ? { updates: [...page.updates], dirty: page.dirty } : null;
  }

  async append(pageId: string, update: Uint8Array, local: boolean): Promise<void> {
    const page = this.pages.get(pageId) ?? { updates: [], dirty: false };
    page.updates.push(update);
    if (local) page.dirty = true;
    this.pages.set(pageId, page);
  }

  async markSynced(pageId: string): Promise<void> {
    const page = this.pages.get(pageId);
    if (page) page.dirty = false;
  }

  async compact(pageId: string, state: Uint8Array): Promise<void> {
    const page = this.pages.get(pageId);
    if (page) page.updates = [state];
  }

  async isDirty(pageId: string): Promise<boolean> {
    return this.pages.get(pageId)?.dirty ?? false;
  }

  async remove(pageId: string, options?: { force?: boolean }): Promise<void> {
    if (options?.force || !this.pages.get(pageId)?.dirty) this.pages.delete(pageId);
  }

  async clear(): Promise<void> {
    this.pages.clear();
  }
}
