import type { Page } from '@/lib/types/pages';
import type { PageGrant, PageGrantRole, PageRole } from './use-page-permissions';
import { hasRole } from './workspace-roles';

export const PAGE_GRANT_ROLES: PageGrantRole[] = ['viewer', 'commenter', 'editor', 'admin'];
export function canAssignPageRole(caller: PageRole, role: PageGrantRole): boolean {
  return hasRole(caller, 'editor') && hasRole(caller, role);
}
export function canManagePageGrant(caller: PageRole, grant: PageGrant): boolean {
  return !grant.inheritedFrom && canAssignPageRole(caller, grant.role);
}
export function canRestrictPage(caller: PageRole, creatorId: string, userId?: string): boolean {
  return hasRole(caller, 'admin') || creatorId === userId;
}

/**
 * Whether `role` reads the page's content without changing it: below editor,
 * or the page is locked, or in the trash (restoring it makes it editable).
 */
export function pageContentReadOnly(
  page: Pick<Page, 'locked' | 'archived'>,
  role: PageRole | undefined,
): boolean {
  return !hasRole(role, 'editor') || page.locked || page.archived;
}
