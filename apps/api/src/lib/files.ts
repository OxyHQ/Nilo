/**
 * URLs for attachments in Oxy's file manager (`@oxy.so/nilo-contracts` `files.ts`).
 *
 * Oxy mints a short-lived URL only for a file whose owner linked it to Nilo,
 * through Nilo's workload identity (Oxy ADR 0021); deciding
 * who may have it is Nilo's job, done before anything here is called
 * (`repositories/pageFiles.ts`).
 *
 * Oxy allows an application 120 mints a minute, so a minted URL is kept in
 * Redis, shared by every task, and handed out again until a minute before it
 * expires. A URL is a credential for those minutes: it is never logged.
 */
import type { FileUrl } from '@oxy.so/nilo-contracts';
import { oxyClient } from '../middleware/auth.js';
import { log } from './logger.js';
import { getRedisClient, withRedisTimeout } from './redis.js';

/** Most ids Oxy mints in one call. */
const OXY_BATCH = 25;
/** A cached URL is handed out only while it has at least this long left. */
const REUSE_MARGIN_MS = 60_000;
const LOCAL_MAX_ENTRIES = 5_000;

export interface MintedFile {
  url: string;
  /** Epoch ms after which `url` stops working. */
  expiresAt: number;
  /** Measured by Oxy. */
  mime: string;
  size: number;
}

const local = new Map<string, MintedFile>();
const cacheKey = (fileId: string) => `nilo:file-url:${fileId}`;

function isMinted(value: unknown): value is MintedFile {
  const v = value as MintedFile | null;
  return (
    typeof v?.url === 'string' &&
    typeof v.expiresAt === 'number' &&
    typeof v.mime === 'string' &&
    typeof v.size === 'number'
  );
}

async function readCache(fileIds: readonly string[]): Promise<Map<string, MintedFile>> {
  const found = new Map<string, MintedFile>();
  const redis = getRedisClient();
  if (redis) {
    try {
      const values = await withRedisTimeout(redis.mget(...fileIds.map(cacheKey)));
      values.forEach((raw, i) => {
        if (!raw) return;
        const parsed: unknown = JSON.parse(raw);
        if (isMinted(parsed)) found.set(fileIds[i] as string, parsed);
      });
      return found;
    } catch (err: unknown) {
      log.general.warn({ err }, 'File URL cache read failed; minting anew');
      return found;
    }
  }
  for (const id of fileIds) {
    const hit = local.get(id);
    if (hit) found.set(id, hit);
  }
  return found;
}

async function writeCache(entries: ReadonlyMap<string, MintedFile>): Promise<void> {
  const now = Date.now();
  const redis = getRedisClient();
  if (redis) {
    try {
      const pipeline = redis.pipeline();
      for (const [id, minted] of entries) {
        const ttl = minted.expiresAt - now - REUSE_MARGIN_MS;
        if (ttl > 0) pipeline.set(cacheKey(id), JSON.stringify(minted), 'PX', ttl);
      }
      await withRedisTimeout(pipeline.exec());
    } catch (err: unknown) {
      log.general.warn({ err }, 'File URL cache write failed');
    }
    return;
  }
  if (local.size + entries.size > LOCAL_MAX_ENTRIES) {
    for (const [id, minted] of local)
      if (minted.expiresAt - now <= REUSE_MARGIN_MS) local.delete(id);
    if (local.size + entries.size > LOCAL_MAX_ENTRIES) local.clear();
  }
  for (const [id, minted] of entries) local.set(id, minted);
}

/**
 * URLs for `fileIds`, reusing cached ones. A file Oxy will not serve to Nilo
 * (unknown, deleted, or not linked to Nilo by its owner) is simply absent.
 * Throws when Oxy cannot be asked at all.
 */
export async function mintFileUrls(fileIds: readonly string[]): Promise<Map<string, MintedFile>> {
  const ids = [...new Set(fileIds)];
  if (ids.length === 0) return new Map();
  const now = Date.now();
  const out = new Map<string, MintedFile>();
  for (const [id, minted] of await readCache(ids)) {
    if (minted.expiresAt - now > REUSE_MARGIN_MS) out.set(id, minted);
  }
  const missing = ids.filter((id) => !out.has(id));
  const fresh = new Map<string, MintedFile>();
  for (let i = 0; i < missing.length; i += OXY_BATCH) {
    const minted = await oxyClient.assets.linkedDownloadUrls(missing.slice(i, i + OXY_BATCH));
    for (const file of minted) {
      fresh.set(file.id, {
        url: file.url,
        expiresAt: now + file.expiresIn * 1000,
        mime: file.mime,
        size: file.size,
      });
    }
  }
  if (fresh.size > 0) await writeCache(fresh);
  for (const [id, minted] of fresh) out.set(id, minted);
  return out;
}

/** The minted URLs of `fileIds` that have one, in the API's shape. */
export function toFileUrls(
  fileIds: readonly string[],
  minted: ReadonlyMap<string, MintedFile>,
): FileUrl[] {
  const now = Date.now();
  return fileIds.flatMap((id) => {
    const file = minted.get(id);
    return file
      ? [{ id, url: file.url, expiresIn: Math.max(0, Math.floor((file.expiresAt - now) / 1000)) }]
      : [];
  });
}

/** For tests: forget the in-process cache. */
export function resetLocalFileUrls(): void {
  local.clear();
}
