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
