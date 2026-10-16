# Nilo API reference

Last verified against `apps/api/src/index.ts` and `apps/api/src/routes/*`:
2026-10-15. The routes are the source of truth; this is the map.

There is currently no public production base URL. Clients receive the intended
origin through `EXPO_PUBLIC_API_URL`.

Protected routes accept an Oxy session in `Authorization: Bearer <token>`.
Public exceptions: liveness/readiness, share tokens, published pages, form
links, embed previews and the browser-push public key — rate limited per
client address. Who may do what on a page is `docs/access.md`.

Nilo is a workspace API, not an inference data plane: there is no provider,
model, credential, conversation or chat-completion route.

## Workspaces and teamspaces

- `GET/POST /workspaces`, `GET/PATCH/DELETE /workspaces/:id`, members
  (`GET/POST /workspaces/:id/members`, `PATCH/DELETE …/members/:userId`),
  `POST /workspaces/:id/trash/empty`.
- `GET /workspaces/personal` — the caller's personal workspace, provisioned
  on the spot (see `docs/access.md`). `POST /workspaces/:id/reset`
  `{ confirm: <current name> }` — owner only, personal only: permanently
  removes every page, database, comment and extra teamspace, keeps the id.
- `GET/POST /workspaces/:id/teamspaces`, `PATCH /teamspaces/:id`, members
  (`GET /teamspaces/:id/members`, `PUT/DELETE …/members/:userId`),
  `POST /teamspaces/:id/join`.

## Pages

- `GET /pages?workspaceId` (only what the caller opens; `sharedWithMe` marks
  what was shared with them), `GET /pages/shared` (as a guest elsewhere),
  `POST /pages` (`teamspaceId`: a teamspace, null for private, absent for
  the default), `GET/PATCH/DELETE /pages/:id` (layout, lock, place, move),
  `POST /pages/:id/duplicate`, `GET /pages/:id/breadcrumb`,
  `GET /pages/:id/export` (Markdown or HTML).
- Sharing: `GET/POST /pages/:id/permissions`, `PUT/DELETE …/permissions/:userId`;
  share links `GET/POST /pages/:id/share`, `DELETE /share-links/:id`,
  `GET /share/:token`, `POST /share/:token/join`.
- Publishing: `POST/DELETE /pages/:id/publish`, public
  `GET /public/pages/:slug[/:pageId]`.
- `GET /pages/:id/backlinks`, `GET/PUT/DELETE /pages/:id/follow`,
  history (`GET /pages/:id/versions[/:versionId]`,
  `POST …/versions/:versionId/restore`), reminders
  (`GET/POST /pages/:id/reminders`, `GET /reminders`, `DELETE /reminders/:id`).
- Import: `POST /pages/import` (Markdown/HTML/JSON files),
  `POST /pages/import/zip` (a Notion export).

## Blocks and comments

- Blocks are written only by transactions (`docs/collaboration.md`):
  `GET /pages/:id/blocks`, `POST /pages/:id/blocks/transactions`,
  `POST /pages/:id/blocks/resume`.
- Comments: `GET/POST /pages/:id/comments`, `GET /blocks/:id/comments`,
  `PATCH/DELETE /comments/:id`, `POST /comments/:id/resolve|unresolve`,
  `PUT/DELETE /comments/:id/reactions/:emoji`.

## Databases

`docs/databases.md` for the model. `GET/POST /databases`,
`GET/PATCH/DELETE /databases/:id`, properties (`POST /databases/:id/properties`,
`PATCH/DELETE …/properties/:propertyId`), rows (`GET/POST /databases/:id/rows`,
`GET …/rows/:rowId`; a row is a page, edited with `PATCH /pages/:id`), views
(`GET/POST /databases/:id/views[?blockId]`, `PATCH/DELETE …/views/:viewId`),
`GET /databases/:id/templates`, `GET /databases/:id/export?format=csv`,
`POST /databases/import/csv`, forms (`GET/PUT/DELETE
/databases/:id/views/:viewId/form`, public `GET/POST /forms/:token`).

## Search, files, embeds, feedback

- `GET /search?workspaceId&q` — titles and text, accent-insensitive.
- `POST /pages/:id/files { fileId, name }` (editor) — record a file uploaded
  to Oxy and linked to Nilo as an attachment of the page.
- `POST /pages/:id/files/urls`, `POST /share/:token/files/urls`,
  `POST /public/pages/:slug/files/urls { pageId? }` — `{ ids }` → short-lived
  URLs for the files the reader may see (`docs/files.md`).
- `POST /embed/preview` — a URL's metadata, fetched safely (no private
  addresses).
- `POST/GET /feedback`, `GET /feedback/:id`.

## Notifications

`GET /notifications`, `GET /notifications/unread-count`,
`PATCH /notifications/:id/read|dismiss`, `POST /notifications/read-all`, Expo
push tokens and browser push subscriptions, `GET /notifications/vapid-public-key`.
Types: `mention` (in comments and in page text), `comment_reply`,
`page_comment` and `page_edited` (pages followed), `page_shared`, `reminder`.

## Real time (Socket.IO)

Page rooms (`page:join`, transactions, presence, `page:comments`), workspace
rooms (`workspace:changed`, `workspace:reset`) and database rooms (`database:changed`):
`docs/collaboration.md`.

## Health

- `GET /health/live` reports process liveness.
- `GET /health/ready` verifies PostgreSQL readiness.
- `GET /health` returns the current PostgreSQL-backed health snapshot.
