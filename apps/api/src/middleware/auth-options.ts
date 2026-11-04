/**
 * How every mount resolves a session: `middleware/auth.ts`'s and the rate
 * limiters' (`lib/rate-limit.ts`), which run first, so a route's own guard
 * finds the request already resolved and keeps it. `loadUser` keeps the
 * profile the validation already returned (no extra round trip):
 * `req.user.email` is the account's own address, which accepts the workspace
 * invitations waiting for it (`routes/workspaces.ts`, `docs/access.md`).
 */
export const oxyAuthOptions = { loadUser: true };
