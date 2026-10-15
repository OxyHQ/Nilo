import i18n from "@/lib/i18n";
import type { WorkspaceRole } from "@/lib/hooks/use-workspaces";

/**
 * Display name for a workspace role, in the active locale. The role id itself
 * (`"viewer"`, `"admin"`…) is what the API stores and is never translated.
 * Resolved at call time so a language change applies on the next render.
 */
export function roleLabel(role: WorkspaceRole): string {
  switch (role) {
    case "owner":
      return i18n.t("workspace.roles.owner.label");
    case "admin":
      return i18n.t("workspace.roles.admin.label");
    case "editor":
      return i18n.t("workspace.roles.editor.label");
    case "commenter":
      return i18n.t("workspace.roles.commenter.label");
    case "viewer":
      return i18n.t("workspace.roles.viewer.label");
  }
}

/** One-line summary of what a workspace role can do, in the active locale. */
export function roleDescription(role: WorkspaceRole): string {
  switch (role) {
    case "owner":
      return i18n.t("workspace.roles.owner.description");
    case "admin":
      return i18n.t("workspace.roles.admin.description");
    case "editor":
      return i18n.t("workspace.roles.editor.description");
    case "commenter":
      return i18n.t("workspace.roles.commenter.description");
    case "viewer":
      return i18n.t("workspace.roles.viewer.description");
  }
}
