/**
 * Where offline copies of pages live. The app on iOS and Android keeps them
 * as files (`offline-files.native.ts`); in a browser there are none, as in
 * Notion: the web app needs its connection.
 */
export interface OfflineFiles {
  read(name: string): Promise<string | null>;
  /** Replaces the file whole, or leaves the old one. */
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
  clear(): Promise<void>;
}

export const offlineFiles: OfflineFiles | null = null;
