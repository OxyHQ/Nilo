# Synchronizing pending changes after a page closes

This document describes the current session guarantees and the follow-up design
for pending offline document changes. Closed pages do not already synchronize.
The scope is existing Yjs documents; offline page creation, database caching,
new transports, and background execution while the app is suspended are excluded.

## Existing owners and the missing behavior

- `lib/editor/page-session.ts` owns the Y.Doc, the page room, the Yjs handshake,
  outgoing updates, and device persistence. Its handshake sends changes the
  server lacks while a writable session is alive.
- `lib/editor/shared-sessions.ts` shares one session per page among editor and
  synced-block holders. The last release disposes that session.
- `lib/editor/doc-store{,.native}.ts` retains updates and a dirty flag in
  IndexedDB on web or SQLite on native. `MemoryPageDocStore` supplies the test
  implementation of that same contract.
- `lib/editor/offline-pages.ts` indexes download choices and recent pages. That
  index is not the inventory of pending work: a dirty document can exist without
  an index entry. Web has IndexedDB implementations of both document and file
  stores; native has SQLite and file storage.
- `lib/editor/offline-sync.ts` refreshes pinned pages by fetching a server diff.
  It does not send local changes. `useOfflineSync` invokes that pull on authenticated
  mounting and network reconnection, without keeping closed page sessions alive.

Consequently, a pending change in a closed page currently waits until a session
for that page opens again. The missing push should hold the existing session,
not implement another Yjs protocol or a second persistent work queue.

## Current guarantees within one process

`PageSession` serializes appends, compaction, and confirmation. A server ACK does
not change the display to saved before earlier device writes and `markSynced`
finish. A local edit arriving before confirmation runs prevents that confirmation
from clearing newer work. A read-only handshake computes the missing server diff
and preserves a dirty draft when the server lacks it; downloading remote state
alone cannot mark that draft as sent.

`shared-sessions.ts` coordinates closure and reopening for each page. A new holder
waits for the previous session's persistence and retention callback before loading
the base document. A holder released while waiting never starts afterward. The
close barrier distinguishes persistence from retention: download removal waits
only for persistence, because the retention callback uses the same offline-index
queue that removal already owns. This prevents a circular wait without allowing a
new session to load a base still being compacted or removed.

Account purges use `withPageSessionsDrained`: detach sessions synchronously without
flushing queued updates, reject new holds during the purge, settle existing writes,
closures, and removals, then clear device data. Old holders cannot reactivate or
remove a later session. Callbacks from disposed sessions cannot recreate data
after the clear. The existing sign-out, account-switch, and external-session
retention policies remain unchanged.

These guarantees are local to one JavaScript process. They do not provide atomic
coordination with another browser tab, a background synchronization pass, or the
revision-aware confirmation and compaction contract below.

## Required persistence contract for background synchronization

Enumerate pending work in `PageDocStore` through `listDirtyPageIds()`. Implement
it in all three stores; do not infer pending work from pinned/recent metadata.

A boolean dirty flag alone cannot safely acknowledge work when asynchronous
writes or another browser tab can change the same document. Introduce a versioned
snapshot contract using the existing update sequence identifiers:

| Operation | Required guarantee |
| --- | --- |
| Load | Return updates, dirty state, and the revision of one consistent snapshot. |
| Append | Always retain the update; atomically report whether the caller's expected revision still matched and return the resulting revision. |
| Confirm | Clear dirty only if the current revision equals the revision of the state actually acknowledged by the server. Return whether that comparison succeeded. |
| Compact | Replace updates only if the captured snapshot revision still matches. A conflict retains all updates and skips replacement. |
| Enumerate dirty | Read document metadata, including documents absent from the download index. |

A revision must identify the state known to the session, not simply the latest
sequence number read when an ACK arrives. If another tab appended unseen work,
a later local append must not silently advance the session's trusted revision
past it. A revision conflict requires loading and merging the newer persisted
updates before another confirmation attempt. The dirty flag remains set meanwhile.
Compaction follows the same rule; fixing confirmation alone does not prevent an
old closing session from overwriting newer work.

IndexedDB comparisons and writes belong to one read/write transaction across the
necessary stores. SQLite comparisons and writes must be atomic against concurrent
calls, using its actual transaction guarantees. The memory implementation must
model these conditional outcomes rather than always accepting a revision.
No application-server database or secondary persistence path is introduced.

## Session confirmation and disposal

The existing serialization in `PageSession` must extend to conditional revision
operations. Store failures use the existing rejection contract and cannot produce
a successful durable confirmation.

A successful session confirmation requires both server and device evidence:

1. A current connection's handshake determines what the server lacks.
2. Any missing local update receives a successful `doc:update` ACK. A successful
   read-only handshake alone is not acknowledgement of a local draft.
3. All relevant persistence operations finish, and the conditional dirty clear
   succeeds for the acknowledged state.
4. Only then notify holders of durable confirmation. The initial `saved` display
   status is not this signal.

Scope callbacks to a connection generation. A late ACK from a disconnected
connection cannot decrement a new connection's pending count or clear new work.
A successful later batch cannot hide an earlier refused batch. Reconnection must
reconcile the full remaining document before certifying it.

A read-only session with a dirty local copy preserves the draft and never marks
it synced merely because it downloaded the server's state. Locked, archived,
forbidden, oversized, and failed updates also remain pending. A clean read-only
copy can still receive remote changes normally.

Use the existing shared-session close barrier for foreground and background
holders. Preserve its distinction between persistence and retention when adding
revision checks; download removal must not wait for its own offline-index queue.

## Bounded synchronization through existing sessions

After the foundations above are established, extend the authenticated offline
lifecycle with one coalesced pass on mount, reconnection, and return to foreground:

1. Capture the account generation and enumerate dirty documents after pending
   closes have settled.
2. Hold one page at a time using `holdPageSession`. Reuse its normal socket and
   server authorization; a simultaneous editor shares the same Y.Doc and room.
3. Wait for explicit durable confirmation, a rejection, disconnection, cancellation,
   or a bounded per-attempt deadline. A deadline ends an attempt; it does not
   declare success or remove the draft.
4. Release only the background holder and continue through that finite snapshot.
   Existing foreground holders keep their session alive.
5. Retry remaining work on the next lifecycle event. Do not immediately loop over
   a refused page, poll on an interval, or create another retry transport.

Network events arriving during a pass may request one subsequent pass; they must
not start overlapping scans. Server rejection is authoritative even when the
background holder is writable locally. An app suspended by the operating system
makes no delivery guarantee until it resumes.

## Account and authorization boundaries

Key the lifecycle to the authenticated user ID, not just an authenticated boolean.
Cancellation must synchronously prevent new holds and sends. Then drain owned
sessions and pending persistence before account clearing begins. Account disposal
must not flush unsent updates under a newly selected account. Stale callbacks must
not recreate data after the clear; opening the next account waits for this barrier.
Browser contexts sharing storage also need account ownership checks coordinated
with the persistence contract, rather than assuming a React effect in one tab can
stop another tab's writes.

Preserve the existing privacy distinction: explicit sign-out and account changes
purge device data; an externally ended session may retain drafts for the same
account. Within the same account, an update refusal must not silently erase a draft.

The pinned-page pull must participate in cancellation before every post-request
write. Its current 403/404 path calls `OfflinePages.forget`, which force-removes
unsent work. Before combining pull and push, separate removing a download choice
or an obsolete clean copy from purging a dirty draft. Otherwise the pull could
undo the push's preservation guarantees. Do not broaden access to a denied page
in the UI to expose the retained draft.

## Validation required before integration

Use real Yjs updates and the existing room/session test doubles. Verify:

- Edit offline, close, reconnect without reopening: server receives the change,
  the device becomes clean only after durable confirmation, and another device
  receives the same merged document.
- Foreground and background holders share one session; opening, closing, and
  cancellation during an asynchronous close do not lose the base or start late.
- Delayed appends, delayed confirmation, local edits after ACK, rejected batches,
  stale connection callbacks, and compaction conflicts never clear or replace
  newer pending work.
- Read-only or locked retries preserve dirty data, stop after one attempt, and
  succeed after permission returns and a new lifecycle event occurs.
- Switching accounts while loading, sending, pulling pinned pages, or disposing
  cannot transmit as the new account or write after the privacy purge.
- IndexedDB and SQLite adapters enforce the same conditional-write contract,
  including concurrent writers and failures. Memory tests alone do not prove
  either adapter's transaction behavior.

Current regression tests use actual session owners, real Yjs updates, and a
controlled asynchronous memory store. They cover read-only draft preservation,
ACKs waiting for appends, close/reopen ordering, cancellation during close,
download removal during retention, and late callbacks around account purges.
These tests establish the owner contract at asynchronous boundaries; they do not
prove cross-tab atomicity or either platform adapter's transaction behavior.
