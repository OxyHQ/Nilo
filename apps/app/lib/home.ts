/**
 * What the Home screen shows (`app/(app)/index.tsx`), as Notion's does: a
 * greeting for the time of day and the pages last visited on this device.
 */
import type { Page } from '@/lib/types/pages';

/** How many visited pages Home lists. */
export const HOME_RECENT_LIMIT = 8;

/**
 * The pages of `recentIds` (most recent first) that are still pages to go
 * back to: not in the trash, not a template, not a database's row (a row is
 * reached through its database).
 */
export function recentlyVisited(
  pages: readonly Page[],
  recentIds: readonly string[],
  limit = HOME_RECENT_LIMIT,
): Page[] {
  const byId = new Map(pages.map((page) => [page.id, page] as const));
  const out: Page[] = [];
  for (const id of recentIds) {
    const page = byId.get(id);
    if (!page || page.archived || page.template || page.databaseId) continue;
    out.push(page);
    if (out.length >= limit) break;
  }
  return out;
}

export type GreetingKey = 'morning' | 'afternoon' | 'evening';

/** The greeting for the reader's local time. */
export function greetingFor(now: Date): GreetingKey {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}
