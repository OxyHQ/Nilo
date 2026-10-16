# Editing and real-time collaboration

How a page's blocks are edited, kept the same for everyone who has the page
open, and kept on the device. The editor is `@oxy.so/bloom-editor` (Bloom
repo); its Yjs layer is `@oxy.so/bloom-editor/yjs`. Nilo's side is
`apps/app/lib/editor/` and `apps/api/src/lib/page-docs.ts`.

## A page is a Yjs document

A page's truth is a `Y.Doc` in the layout `@oxy.so/bloom-editor/yjs`
defines: one `blocks` map from block id to the block's own map, holding
`type`, `parent`, `index` (a fractional key among its siblings), `props` (a
map, so two people changing different properties both win) and `text` (a
`Y.Text`, marks as attributes).

There are no children arrays. A block's place is written on the block alone
(`parent` and `index` together), so a block moved by two people at once lands
in one place, never two. What a tree needs and a CRDT cannot promise is
settled when the document is read (`materialize`), the same way on every
device:

- siblings sort by key, then by id (two blocks given the same key at once
  still have one order);
- a block whose parent was removed goes with it (the removal wins over a
  child added at the same time);
- a cycle made by two moves is broken at its smallest id, which goes to the
  top level.

Two people typing in one block both keep their words: text edits are minimal
(`updateSegments`), and a mark change reformats instead of rewriting, so text
typed into a stretch being bolded is kept.

## The editor and the document

`YjsBinding` keeps an `EditorStore` and the `Y.Doc` the same. Every edit,
undo and redo the person makes is written into the document; every change
the document takes from elsewhere (a collaborator, the device's copy, the
server) is applied to the store as a remote transaction, outside the undo
history. Undo takes back only the person's own change, whatever others did
since.

A reader (viewer, commenter) writes nothing into the document. Their own
changes (a toggle they closed) stay theirs: each change from the document is
put on top of them, a property changed only where it changed.

## Storage and the server

`apps/api/src/lib/page-docs.ts`:

- `page_updates`: every update anyone sends, appended in arrival order;
  `page_docs`: the compacted snapshot (updates folded in once 200 wait, and
  only those the rows already show: the rest still say who made them).
  The document is the merge of both, the same whatever order updates
  arrived in.
- Appending holds the page row FOR SHARE and compaction FOR UPDATE, so an
  update can never get an id at or below a snapshot that did not include it.
  Reading takes the snapshot and the updates in one repeatable-read
  transaction.
- A page that predates its document is stored from its block rows once, under
  the page's row lock (two first readers cannot both seed it).
- An empty, oversized (`MAX_DOC_UPDATE_BYTES`, 8 MB, in
  `@oxy.so/nilo-contracts`), malformed update, or one to a gone or locked page
  is refused. The socket's message limit is set from the same number
  (`SOCKET_MAX_MESSAGE_BYTES`), so an oversized change is answered
  (`UPDATE_TOO_LARGE`), never a dropped connection. A page in the trash is not open to editors (its room
  refuses them) but keeps content a server write may change.

## The room

`apps/api/src/collab/page-docs.ts`, over the page's room (`page:<id>`; joining
checks the person may read the page):

- `doc:sync { pageId, stateVector }` → `{ update, stateVector }`: the Yjs
  handshake. The server sends what the device lacks; the device then sends
  what the server lacks.
- `doc:update { pageId, update }` → `{ ok }`: one change, from someone who
  may edit the page (checked again every ten seconds per page). Stored, sent
  to everyone else in the room, projected once the burst settles.

The Redis adapter carries the room across the API's tasks.

## The session on the device

`apps/app/lib/editor/page-session.ts`, wired by `usePageEditor`:

- Opening: the device's copy first, so the page shows without a connection;
  then the server's state.
- Each time the socket connects: join the room, then the handshake both
  ways. Work done offline arrives this way, merged, however long ago it was
  done.
- While connected: the person's changes go out in batches of 60 ms; everyone
  else's come in from the room, taken whenever they arrive (one broadcast
  between joining and the handshake's answer is in neither otherwise).
- Status: `saving` while changes are on their way, `saved` once the server
  confirmed them all, `offline` without a connection, `error` when the
  server refused one (a read-only or locked page; the change stays on the
  device, sent by the next handshake). A change over the size limit is not
  sent at all: the person is told, and undoing it leaves little to send (Yjs
  keeps only the length of deleted text).

## On the device

`apps/app/lib/editor/doc-store*.ts`: every update the page takes is written
to the device — SQLite on iOS and Android, IndexedDB in a browser. A page is
`dirty` while it holds a change of the device's the server has not
confirmed; nothing removes a dirty page but signing out.

What stays once a page is closed: on iOS and Android, the pages kept for
reading offline (`offline-pages.ts`: pinned, or among the last 20 opened) and
dirty ones; in a browser, dirty ones only. Pinned pages are brought up to date
in the background through `POST /pages/:id/doc` (the handshake over HTTP).
Signing out, or another account signing in, removes every document stored.

Yjs reads `crypto.getRandomValues` the moment it loads: the app installs it
from `expo-crypto` (`expo-standard-web-crypto`) first thing at its entry, and
Metro resolves lib0's Web Crypto to its standard build on iOS and Android
(`metro.config.js`; lib0's React Native build needs `expo-random`, gone from
Expo).

## The rows

`apps/api/src/lib/page-projection.ts`. The `blocks` rows everything that does
not edit reads (search, exports, share links, published pages, backlinks,
file access) are projected from the document: shortly after changes settle,
and at once when a reader needs them now (an export, a copy, a server-side
change). The document is read inside the page's row lock, so an older state
never lands over a newer one.

What is left to project is in the database, never only in a process: the
first update after a projection marks the page (`page_docs.dirty_since`), a
projection records the newest update it showed (`projected_through_id`) and
clears the mark, and who edited is read from the updates themselves. Every
task sweeps every five seconds for pages marked over ten seconds ago (their
task stopped, or their projection failed), and at start and every fifteen
minutes marks any page with an update its rows do not show. Shutdown projects
what the task had waiting. A block whose id belongs to another page, or of
an unknown type, is left out with its subtree.

Projecting does what an edit means for a page: history (below), who edited
it last, following it, a `mention` notification to each person newly
mentioned who can open the page (never the writer), and a grouped
`page_edited` notification to its followers.

## Writing without an editor

`POST /pages/:pageId/blocks/transactions { ops }` (and imports, restores):
an ordered list of insert / update / move / remove operations, positions as
anchors ("after this block"), validated one after another, all or none, then
written into the document as one change (`lib/block-transactions.ts`). Open
editors receive it live; the rows are projected before the request answers.

## Live outside the editor

`collab/live-rooms.ts`: a member joins `workspace:<id>` (a guest with a page
shared there too) and hears `workspace:changed` when its page tree changes;
anyone who can open a database joins `database:<id>` and hears
`database:changed` when its rows, properties or views change. Events carry
ids only — clients read again through the API — and bursts are coalesced.
The routes announce a change once their write is done (`announceChange`).

## Page history

Before the first change after ten quiet minutes the projection keeps the
page's blocks as a version (`page_versions`, newest 200), and a restore keeps
the page as it is first. A restore is one change to the document, from the
document as it is to the version (block ids kept, so comment anchors stay),
so open editors receive it live.

## Tests

- `@oxy.so/bloom-editor` `src/yjs/__tests__` — the layout and the binding:
  two people in one block, bolding while another types, concurrent moves, a
  cycle, a removal against an added child, tied keys, undo after a remote
  edit, a reader's own changes, and 25 seeds of 300 random edits on three
  devices.
- `apps/api/src/lib/page-docs.pgdb.test.ts`, `collab/page-rooms.pgdb.test.ts`
  — seeding, compaction, refusals; the room carrying edits, refusing a
  viewer's, merging offline work.
- `apps/app/lib/editor/__tests__/page-session.test.ts` — the session against
  a fake room.
- `e2e/live-editing.test.ts` — editors wired as the app wires them, against
  the real room and PostgreSQL: the editors, the server's document and the
  projected rows must be the same page, with seeded random concurrent edits
  and dropped connections. `LIVE_SEEDS=1,2,3 LIVE_STEPS=200` runs a longer
  soak; `LIVE_DEBUG=1` prints the gap of a failing run.

## Canvas pages

A page whose `mode` is `canvas` lays its top-level blocks out as notes
(`canvas_note`, with `x`, `y` and `width` in its content) on an infinite
surface; each note holds its own blocks. Notes are blocks like any other, so
moving, resizing, writing in and deleting them are changes to the document:
they sync, undo, work offline and respect the lock as everything else does.
Turning a page into a canvas wraps its blocks in one note; turning it back
puts each note's blocks in place, notes read top to bottom then left to right
(`apps/app/lib/editor/canvas.ts`). Exports and published pages read a canvas
in that order.
