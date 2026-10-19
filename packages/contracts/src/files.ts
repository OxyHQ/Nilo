/**
 * Attachments live in Oxy's file manager (Oxy ADR 0021), never in a bucket of
 * Nilo's own. The member who uploads a file owns it in Oxy and links it to
 * Nilo; Nilo records which workspace and page it belongs to and, after its
 * own access check, mints short-lived URLs for it. A block keeps the file's
 * id, never a URL: a URL is a credential that expires.
 */

/**
 * Nilo's application id in Oxy. Oxy serves a file to Nilo only when the
 * file's owner linked it under this exact id: it is the identity Oxy mints
 * Nilo's service tokens for, so it is a constant, not configuration.
 */
export const NILO_OXY_APPLICATION_ID = 'ed143b1b58d60eab417f7d5c';

/**
 * The entity a Nilo file is linked to in Oxy: the page it was uploaded to.
 * The owner's link is Oxy's reference of Nilo's use of the file (Oxy ADR
 * 0043); Nilo removes it with its service token once it stops using the file.
 */
export const NILO_FILE_ENTITY_TYPE = 'page';

/** Largest file a member may attach, in bytes. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

/** How many file ids one request may ask URLs for. */
export const MAX_FILE_URL_IDS = 50;

/** A file's place in a request for its URL: who is asking, through what. */
export type FileUrlScope =
  | { kind: 'page'; pageId: string }
  | { kind: 'share'; token: string }
  | { kind: 'published'; slug: string; pageId: string };

/** A minted URL, as the API returns it. */
export interface FileUrl {
  id: string;
  url: string;
  /** Seconds from now until `url` stops working. */
  expiresIn: number;
}

/**
 * What a request for file URLs answers: a URL for each requested file the
 * reader may have and Oxy serves, and the ids of those Oxy has said it no
 * longer serves (deleted, moved to its owner's trash, or taken down) — shown
 * as removed, never from a copy kept on the device. Any other id is left out
 * of both, and its absence says nothing about whether it exists.
 */
export interface FileUrlsResponse {
  files: FileUrl[];
  removed: string[];
}

/** The id of the Oxy file a block holds, or null for a block that points at a URL. */
export function blockFileId(content: object): string | null {
  const id = (content as { fileId?: unknown }).fileId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * A page's icon or cover can be an image uploaded to the page, stored as
 * `file:<fileId>` (the app's `icon-value.ts` and `cover-value.ts`). The page
 * holds that file as a block would.
 */
export const PAGE_FILE_PREFIX = 'file:';

/** The id of the file a page's icon or cover names, or null for any other value. */
export function pageValueFileId(value: string | null | undefined): string | null {
  if (!value?.startsWith(PAGE_FILE_PREFIX)) return null;
  const id = value.slice(PAGE_FILE_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}
