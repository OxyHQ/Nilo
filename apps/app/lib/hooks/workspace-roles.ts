import type { WorkspaceRole } from "./use-workspaces";

/**
 * Role hierarchy mirrors `apps/api/src/models/workspace-member.ts`.
 * Frontend uses it to gate UI affordances; the backend enforces
 * authorisation independently.
 */
export const WORKSPACE_ROLES: WorkspaceRole[] = [
  "viewer",
  "commenter",
  "editor",
  "admin",
  "owner",
];

export function compareRoles(a: WorkspaceRole, b: WorkspaceRole): number {
  return WORKSPACE_ROLES.indexOf(a) - WORKSPACE_ROLES.indexOf(b);
}

export function hasRole(
  actual: WorkspaceRole | undefined,
  required: WorkspaceRole,
): boolean {
  if (!actual) return false;
  return compareRoles(actual, required) >= 0;
}
