# Who can open and change a page

The rule lives in `apps/api/src/lib/page-access.ts`; every page, block,
comment, database, history and page-room route uses it.

## Roles

`viewer` < `commenter` < `editor` < `admin` (full access) < `owner`.
Members get a workspace role. A page can also be shared with a person
directly (`page_permissions`) with any role but `owner`, member or **guest**
(not a member of the workspace). A grant covers the page and its subtree.

## The effective role

Walking from the page up to the nearest **restricted** page (or the top):

- workspace owners and admins keep their role everywhere;
- otherwise the strongest of the grants on that stretch and, when nothing at
  or above the page is restricted, the member's workspace role;
- no role is no access (403 `NO_PAGE_ACCESS`).

A restricted page (`pages.restricted`) closes its subtree to members without
a grant reaching it and cuts off grants from above it. Restricting needs full
access or being the page's creator, who keeps access through a grant.

A database row's parent is the page its database sits in
(`databases.parentPageId`): rows of an inline database are as open as that
page. A database in no page is open to the workspace by role.

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

Unauthenticated endpoints are rate limited per client address
(`lib/rate-limit.ts`; Redis when configured).
