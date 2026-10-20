import type { Page } from '../types/pages';
import { useBreadcrumb } from './use-pages';
import { useDatabase } from './use-databases';

export interface PageBreadcrumbPathEntry {
  kind: 'page' | 'database';
  id: string;
  title: string;
  icon: string | null;
  href?: string;
  current: boolean;
}

type BreadcrumbPage = Pick<Page, 'id' | 'workspaceId' | 'title' | 'icon'> &
  Partial<Pick<Page, 'databaseId'>>;

/** A row grant does not grant access to its database or that database's ancestry. */
export function usePageBreadcrumbPath(page: BreadcrumbPage): PageBreadcrumbPathEntry[] {
  const detail = useDatabase(page.databaseId ?? undefined);
  const database =
    page.databaseId && !detail.isError && detail.data?.database.id === page.databaseId
      ? detail.data.database
      : undefined;
  const parentId = page.databaseId ? database?.parentPageId : page.id;
  const ancestry = useBreadcrumb(parentId, database?.workspaceId ?? page.workspaceId);
  const current: PageBreadcrumbPathEntry = {
    kind: 'page',
    id: page.id,
    title: page.title,
    icon: page.icon,
    current: true,
  };

  // Parent removal or a failed permission recheck must not preserve cached names.
  // The database query can subsequently confirm a detached database (no parent).
  if (ancestry.isError || (page.databaseId && !database)) return [current];
  const ancestors: PageBreadcrumbPathEntry[] = (ancestry.data?.breadcrumb ?? [])
    .filter((ancestor) => ancestor.id !== page.id)
    .map((ancestor) => ({
      ...ancestor,
      kind: 'page',
      href: `/p/${ancestor.id}`,
      current: false,
    }));
  if (database) {
    ancestors.push({
      kind: 'database',
      id: database.id,
      title: database.name,
      icon: database.icon,
      href: `/db/${database.id}`,
      current: false,
    });
  }
  return [...ancestors, current];
}
