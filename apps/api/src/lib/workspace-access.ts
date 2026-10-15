import type { NextFunction, Request, Response } from 'express';
import { hasRole, type WorkspaceRole } from '../db/schema/workspaces.js';
import { requireWorkspaceMember } from '../middleware/workspace.js';
import { log } from './logger.js';

/**
 * Role gate for handlers that already ran the membership check, which leaves
 * the caller's role on `req.workspace.role`. Sends a 403 shaped like
 * `requireRole`'s and returns false when the caller is below `minRole`.
 * A missing role fails closed.
 */
export function ensureRole(req: Request, res: Response, minRole: WorkspaceRole): boolean {
  const role = req.workspace?.role;
  if (role && hasRole(role, minRole)) return true;
  res.status(403).json({
    error: 'Forbidden: insufficient role',
    code: 'INSUFFICIENT_ROLE',
    required: minRole,
    actual: role ?? null,
  });
  return false;
}

/**
 * Membership and role check for `:id`-style routes, where the workspace is
 * not in the URL but derived from the loaded resource. Sets X-Workspace-Id
 * from `workspaceId`, runs `requireWorkspaceMember` inline, then asserts the
 * caller holds at least `minRole`.
 *
 * Returns true when the caller may proceed; false with a response already
 * sent otherwise.
 */
export async function checkWorkspaceAccess(
  req: Request,
  res: Response,
  workspaceId: string,
  minRole: WorkspaceRole,
): Promise<boolean> {
  req.headers['x-workspace-id'] = workspaceId;
  const passed = await new Promise<boolean>((resolve) => {
    const next: NextFunction = (err?: unknown) => {
      if (err) {
        log.general.error({ err }, 'Workspace membership middleware errored');
        if (!res.headersSent) {
          res.status(500).json({ error: 'Workspace membership check failed' });
        }
        resolve(false);
        return;
      }
      resolve(true);
    };
    requireWorkspaceMember(req, res, next);
  });
  if (!passed || res.headersSent) return false;
  return ensureRole(req, res, minRole);
}
