import {
  createOptionalOxyAuth,
  createOxyAuthMiddleware,
  type OxyRequestUser,
} from '@oxy.so/core/server';
import type { WorkspaceRole } from '../db/schema/workspaces.js';
import { oxy } from '../oxy.js';
import type { WorkspaceMemberRow, WorkspaceRow } from '../repositories/workspaces.js';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      accessToken?: string;
      user?: OxyRequestUser | null;
      workspaceDoc?: WorkspaceRow;
      member?: WorkspaceMemberRow;
      workspace?: {
        id: string | null;
        role?: WorkspaceRole;
      };
    }
  }
}

/**
 * How every mount here resolves a session — the rate limiters' too, which run
 * first, so a route's own guard finds the request already resolved and keeps
 * it. `loadUser` keeps the profile the validation already returned (no extra
 * round trip): `req.user.email` is the account's own address, which accepts
 * the workspace invitations waiting for it (`routes/workspaces.ts`,
 * `docs/access.md`).
 */
export const oxyAuthOptions = { loadUser: true };

/** Validate an Oxy session and attach its user context to the request. */
export const authenticateToken = createOxyAuthMiddleware(oxy, { auth: oxyAuthOptions });

/**
 * Signed in when a bearer is sent, anonymous when none is; a bearer that is
 * sent and does not validate is refused, never read as anonymous.
 */
export const optionalAuthenticateToken = createOptionalOxyAuth(oxy, {
  auth: { ...oxyAuthOptions, strictOptionalBearer: true },
});
