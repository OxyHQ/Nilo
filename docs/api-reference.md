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

- A page's truth is its Yjs document (`docs/collaboration.md`): editors
  keep it in step over the page's Socket.IO room (`page:join`, `doc:sync`,
  `doc:update`); `POST /pages/:id/doc { stateVector? }` is the same
  handshake over HTTP (base64), for a device refreshing a page it keeps.
- `GET /pages/:id/blocks` — the rows projected from the document.
- `POST /pages/:id/blocks/transactions { ops }` — change blocks without an
  editor (insert / update / move / remove, all or none), as one change to
  the document.
- Comments: `GET/POST /pages/:id/comments`, `GET /blocks/:id/comments`,
  `PATCH/DELETE /comments/:id`, `POST /comments/:id/resolve|unresolve`,
  `PUT/DELETE /comments/:id/reactions/:emoji`.

## Databases

`docs/databases.md` for the model. `GET/POST /databases`,
`GET/PATCH/DELETE /databases/:id`, properties (`POST /databases/:id/properties`,
`PATCH/DELETE …/properties/:propertyId`), rows (`GET/POST /databases/:id/rows`,
`GET …/rows/:rowId`; a row is a page, edited with `PATCH /pages/:id`; the
list takes `viewId`, `search`, `pageSize` and the previous page's opaque
`cursor`, and returns `rows`, `total`, `cursor` and `view`), views
(`GET/POST /databases/:id/views[?blockId]`, `PATCH/DELETE …/views/:viewId`),
`GET /databases/:id/templates`, `GET /databases/:id/export?format=csv`,
`POST /databases/import/csv`, forms (`GET/PUT/DELETE
/databases/:id/views/:viewId/form`, public `GET/POST /forms/:token`).

## Notes (Noted)

Noted's API, over the personal workspace's `notes` and `note_folders` system
databases (`docs/databases.md`). Contract: `packages/contracts/src/notes.ts`.

- `GET /notes?view=active|archived|trashed&label&folder&pinned`,
  `POST /notes` (optional client UUIDv7 `id`; a retry answers 200),
  `GET/PATCH/DELETE /notes/:id`, `POST /notes/reorder { ids }`. A PATCH with
  `baseUpdatedAt` on an older version gets 409 `STALE_NOTE` and the note;
  `appData` is written on `baseRevision` (409 `STALE_APP_DATA`). A note's body
  is its blocks, written whole and applied as block operations.
- `GET /notes/sync?cursor&limit` — paged changes and deletions since the
  cursor; `full` when the pass is the whole set; `reset` when the cursor was
  for notes a workspace reset removed (the client drops everything it holds,
  unsent edits included); labels and folders on a pass's last page.
- `GET /notes/export` — every note (trash included), label and folder as JSON;
  `POST /notes/erase { confirm: 'DELETE' }` — every note, folder and label for
  good (the rest of the workspace stays).
- `GET/POST /notes/labels`, `PATCH/DELETE /notes/labels/:id`;
  `GET/POST /notes/folders`, `PATCH/DELETE /notes/folders/:id` (deleting a
  folder moves its notes and subfolders up).
- History is the page's: `/pages/:id/versions`.

### Notes capabilities (Alia, MCP)

Nilo serves Noted's capability catalog (`apps/api/src/capabilities/`): app id
`noted`, audience `oxy-noted-api`, so grants made on Noted carry over; Nilo's
Oxy application owns the `catalog:noted` namespace and the deploy registers
the catalog after each healthy rollout.

- `/_oxy/capabilities/<tool>` — the twelve tools (`searchNotes`, `readNote`,
  `createNote`, `updateNote`, `archiveNote`, `restoreNote`, `listLabels`,
  `createLabel`, `updateLabel`, `deleteLabel`, `listReminders`,
  `setReminder`) with an Oxy capability ticket (`Authorization: Capability
  <ticket>`), verified, re-authorised live and audited. A note's `body` is
  Markdown in and out. Effectful tools take an `idempotencyKey` and apply
  once per key (`capability_executions`).
- `https://mcp.noted.oxy.so/mcp` and its protected-resource metadata — the
  same tools as a remote MCP server; the host is checked exactly.
- Events for Alia (`note_changed`, `reminder`) are queued with the change in
  `app_event_outbox` and delivered at least once to Alia's `/webhooks/oxy`.

## Search, files, embeds, feedback

- `GET /search?workspaceId&q` — titles and text, accent-insensitive, every word
  as a prefix; in titles a word may also be close (a typo), by trigrams.
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
push tokens and browser push subscriptions (each with its `app`, `nilo` or
`noted`), `GET /notifications/vapid-public-key`. A note's reminder rings in Noted
when the user has it registered, otherwise in Nilo; everything else in Nilo.
Types: `mention` (in comments and in page text), `comment_reply`,
`page_comment` and `page_edited` (pages followed), `page_shared`, `reminder`,
`assigned` (someone added the user to a person property of a row they can
open; never on a template, never to whoever did it).

## Real time (Socket.IO)

Page rooms (`page:join`, transactions, presence, `page:comments`), workspace
rooms (`workspace:changed`, `workspace:reset`) and database rooms (`database:changed`):
`docs/collaboration.md`.

## Health

- `GET /health/live` reports process liveness.
- `GET /health/ready` verifies PostgreSQL readiness.
- `GET /health` returns the current PostgreSQL-backed health snapshot.
