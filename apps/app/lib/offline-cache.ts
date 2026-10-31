/**
 * Which of the app's queries belong to the signed-in account, and which of
 * those it keeps on the device to stand up without a connection.
 *
 * The SDK owns this (`OxyProvider`'s `accountQueries`): every query is the
 * account's, dropped from memory when the account changes. Queries are
 * written to the device under that account alone unless their root is
 * explicitly memory-only. The shell below is kept long enough to stand up
 * offline; a new root is also persisted unless excluded here.
 */
import type { AccountQueriesConfig } from '@oxy.so/services/ui';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

/** How long a kept query may serve without being read again. */
export const SHELL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** What the app needs to stand up offline: workspaces, the sidebar's lists, pages' records. */
export const SHELL_ROOTS = [
  'workspaces',
  'workspace',
  'shared-pages',
  'pages',
  'databases',
  'teamspaces',
  'page',
] as const;

/** The account's, but never written to the device: blocks, comments, search, AI output and file URLs. */
export const MEMORY_ONLY_ROOTS = [
  'breadcrumb-neighbors',
  'ai',
  'blocks',
  'comment-reaction',
  'comments',
  'database',
  'embed-preview',
  'file-url',
  'form-link',
  'forms',
  'member-profiles',
  'notifications',
  'page-permissions',
  'page-activity',
  'public-pages',
  'reminders',
  'search',
  'share-links',
  'shared-page',
  'teamspace-members',
  'unsplash',
  'version',
  'versions',
  'workspace-members',
] as const;

export const ACCOUNT_QUERIES: AccountQueriesConfig = {
  roots: 'all',
  memoryOnlyRoots: MEMORY_ONLY_ROOTS,
};

export function isShellQuery(key: QueryKey): boolean {
  return (SHELL_ROOTS as readonly unknown[]).includes(key[0]);
}

/** Kept queries live as long as they may be restored, and show what they have offline. */
export function configureShellQueries(client: QueryClient): void {
  for (const root of SHELL_ROOTS) {
    client.setQueryDefaults([root], { gcTime: SHELL_MAX_AGE_MS, networkMode: 'offlineFirst' });
  }
}
