/**
 * Workspace / member / share-link query keys.
 *
 * Kept in a separate module from `query-keys.ts` so Phase 2 frontend
 * (this set) and Phase 1 frontend (which extends `query-keys.ts` for
 * pages/blocks) don't fight over the same file during parallel
 * development. These keys are namespaced under `'workspace-*'` /
 * `'workspace-members-*'` / `'share-links-*'` to avoid collisions.
 */
export const workspaceKeys = {
  list: ['workspaces'] as const,
  detail: (id: string) => ['workspace', id] as const,
} as const;

export const workspaceMemberKeys = {
  list: (workspaceId: string) => ['workspace-members', workspaceId] as const,
} as const;

/** Invitations, the join link and guests: what admins manage beside the member list. */
export const workspaceAdminKeys = {
  invites: (workspaceId: string) => ['workspace-invites', workspaceId] as const,
  inviteLink: (workspaceId: string) => ['workspace-invite-link', workspaceId] as const,
  guests: (workspaceId: string) => ['workspace-guests', workspaceId] as const,
  linkPreview: (token: string) => ['workspace-invite-link-preview', token] as const,
  invitationPreview: (token: string) => ['workspace-invitation-preview', token] as const,
} as const;

export const shareLinkKeys = {
  list: (pageId: string) => ['share-links', pageId] as const,
  public: (token: string) => ['shared-page', token] as const,
} as const;
