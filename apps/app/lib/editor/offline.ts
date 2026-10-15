/**
 * A page's unsaved editing, kept on the device: the last document the server
 * confirmed, the changes it has not confirmed yet (`SyncSession.snapshot`)
 * and the server's orders. Written while changes are pending, removed once
 * they are saved; read to open a page without a connection, and to send what
 * a closed app had not.
 */
import { TRANSACTION_KEY_RETENTION_MS } from '@nilo/contracts';
import type { BlockId, EditorDocument, PendingTransaction } from '@oxy.so/bloom-editor/model';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SavedPage {
  version: number;
  base: EditorDocument;
  pending: PendingTransaction[];
  orders: [BlockId, number, number][];
  /** When the oldest of `pending` was made (ms since the epoch). */
  oldestAt: number;
}

const key = (pageId: string) => `nilo:editor:${pageId}`;

/**
 * Saved work is resent only while the server still remembers the keys of what
 * it applied (with an hour to spare): past that, resending a change it already
 * has could apply it again over later edits.
 */
const MAX_AGE_MS = TRANSACTION_KEY_RETENTION_MS - 60 * 60 * 1000;

export async function readSavedPage(pageId: string, now = Date.now()): Promise<SavedPage | null> {
  try {
    const raw = await AsyncStorage.getItem(key(pageId));
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedPage;
    if (now - saved.oldestAt > MAX_AGE_MS) {
      await AsyncStorage.removeItem(key(pageId));
      return null;
    }
    return saved;
  } catch {
    // Unreadable storage is no saved work.
    return null;
  }
}

export async function writeSavedPage(pageId: string, saved: SavedPage): Promise<void> {
  try {
    await AsyncStorage.setItem(key(pageId), JSON.stringify(saved));
  } catch {
    // Full or unavailable storage: the session still has the work in memory.
  }
}

export async function clearSavedPage(pageId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key(pageId));
  } catch {}
}

/** When each pending change was first seen, to know how old saved work is. */
export class PendingClock {
  private readonly seen = new Map<string, number>();

  /** Treat these as made at `at` (work read back from the device). */
  seed(pending: readonly PendingTransaction[], at: number): void {
    for (const { key } of pending) this.seen.set(key, at);
  }

  /** When the oldest of `pending` was made; forgets the confirmed ones. */
  oldest(pending: readonly PendingTransaction[], now = Date.now()): number {
    const keys = new Set(pending.map((p) => p.key));
    for (const key of this.seen.keys()) if (!keys.has(key)) this.seen.delete(key);
    let oldest = now;
    for (const { key } of pending) {
      const at = this.seen.get(key) ?? now;
      this.seen.set(key, at);
      oldest = Math.min(oldest, at);
    }
    return oldest;
  }
}
