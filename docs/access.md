# Who can open and change a page

The rule lives in `apps/api/src/lib/page-access.ts`; every page, block,
comment, database, history and page-room route uses it.

## Roles

`viewer` < `commenter` < `editor` < `admin` (full access) < `owner`.
Members get a workspace role. A page can also be shared with a person
directly (`page_permissions`) with any role but `owner`, member or **guest**
(not a member of the workspace). A grant covers the page and its subtree.

## The personal workspace

Every user has exactly one personal workspace (`workspaces.is_personal`,
unique per owner). It is provisioned whole (workspace, owner membership,
default teamspace, in one transaction) on the first `GET /workspaces` or
`GET /workspaces/personal`, and that same path repairs one missing its owner
row. It takes no invitations, cannot be transferred and can never be archived: the delete route
refuses it and the `workspaces_personal_not_archived` CHECK backs the route.
Its owner can **reset** it instead, which deletes everything in it for good
and keeps the same id. Any other workspace a user needs, they create.

## Joining and leaving a workspace

- Invited by email: an Oxy account with that email becomes a member at once;
  any other email gets an invitation (`workspace_invites`, 30 days) that
  becomes a membership on the first workspace list of someone signed in with
  that Oxy email, or when its own link (`/invite/<token>`) is opened by
  anyone signed in, whatever their email: Oxy emails that link
  (`invitations:email`), and admins can copy it. Renewing an invitation keeps
  its link. Admins list and revoke the invitations waiting.
- The join link (`workspace_invite_links`, one live per workspace) makes
  whoever opens it signed in a member, at most an editor. Disabling or
  regenerating it stops the old link; the members it brought stay.
- A workspace has one owner (`workspaces.owner_id`, the `owner` member).
  They cannot be removed, demoted or leave: they first hand the workspace to
  another member (`POST /workspaces/:id/transfer`), staying as an admin.
- Guests (grants, no membership) are listed for admins with their pages;
  removing one deletes every grant they hold in the workspace.

## Where a page lives

Every page tree starts somewhere, as in Notion's sidebar:

- in a **teamspace** (`teamspaces`): a group of the workspace's members with
  its own pages. A teamspace is `open` (every member of the workspace can
  open its pages and join it), `closed` (listed, its pages only for its
  members) or `private` (only its members know it exists). Its members
  (`teamspace_members`) are `owner`s, who manage it, or `member`s. Every
  workspace has a default, open teamspace that every member belongs to.
- or **private** to its creator: nobody else opens it unless it is shared
  with them.

The top of a tree says where: a top-level page's `teamspace_id`, or for a
database that sits in no page, the database's (`databases.teamspace_id`);
null is private to its owner (`owner_id`). Subpages and rows live where
their tree starts.

## The effective role

The **base** role, from where the tree lives:

- in a teamspace: the workspace's owners and admins keep their role (and
  pass restricted pages); members of the teamspace have their workspace role
  — a teamspace owner at least `admin`; anyone else in the workspace has
  their workspace role in an `open` teamspace and nothing in a `closed` or
  `private` one;
- private: its owner has `admin`; nobody else has anything — workspace
  owners and admins included, as in Notion;
- a guest (no membership) never has a base role.

Then, walking from the page up to the nearest **restricted** page (or the
top): the strongest of the grants on that stretch and, when nothing at or
above the page is restricted, the base role. No role is no access (403
`NO_PAGE_ACCESS`).

A restricted page (`pages.restricted`) closes its subtree to everyone
without a grant reaching it (but workspace owners and admins in a
teamspace) and cuts off grants from above it. Restricting needs full access
or being the page's creator, who keeps access through a grant.

A database row's parent is the page its database sits in
(`databases.parentPageId`): rows of an inline database are as open as that
page.

## Sharing

- `GET/POST/PUT/DELETE /pages/:id/permissions…` — list (with inherited grants
  and profiles), invite by email, change a role, remove or leave. Edit access
  manages sharing; nobody grants more than they hold.
- Share links: read, comment or edit. Opening a comment or edit link while
  signed in (`POST /share/:token/join`) grants that scope, tied to the link;
  revoking the link takes it away.
- Publishing (`POST/DELETE /pages/:id/publish`, public
  `GET /public/pages/:slug[/:pageId]`) exposes a page and its unrestricted
  subpages to anyone, never restricted subtrees.
- Forms (`/databases/:id/views/:viewId/form`, public `/forms/:token`) accept
  responses as rows without exposing the database.
- Search (`GET /search`) returns only pages the caller can open; a guest
  searches the pages shared with them, without the path above them.

Every request counts against the caller's general budget, per member when
signed in and per hashed client address otherwise (the SDK's
`createOxyRateLimit`); public endpoints add a stricter budget of their own
(`lib/rate-limit.ts`). Counted in Redis, so both API tasks share one window.
