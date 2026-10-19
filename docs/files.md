# Files

Attachments (uploaded images and files) live in Oxy's file manager, as every
Oxy app's files do (Oxy ADR 0021). Nilo stores no file and runs no bucket.

## Uploading

The member's app does three things (`apps/app/lib/files/upload-page-file.ts`):

1. It uploads the file to Oxy with the member's own session, as `private`.
   The member owns the file in Oxy, and it counts against their Oxy storage.
2. It links the file to Nilo: `app` is Nilo's application id
   (`NILO_OXY_APPLICATION_ID` in `@oxy.so/nilo-contracts`), with the page as the entity.
3. It records the file on the page: `POST /pages/:id/files { fileId, name }`
   (an editor of the page). The API asks Oxy for a URL. That is how it learns
   the file is linked to Nilo by its owner, and its type and size as Oxy
   measured them. It writes a `page_files` row and answers with a first URL.

A block holds the file's id (`content.fileId`), never a URL. A pasted URL
still goes in `content.url`. A page's icon or cover uploaded the same way is
stored as `file:<fileId>` (`pageValueFileId` in `@oxy.so/nilo-contracts`).
Image, video, audio and file blocks are uploaded to this way.

A video or a sound plays in the native players (`expo-video`, `expo-audio`)
from a minted URL, which the app asks for again before it expires while the
block is shown (`useMediaFileUrl`). A player takes the newer URL only while it
is not playing (`useMediaSource`), so playback is never cut to swap one; a
player streaming one URL for longer than it lasts can still lose it, which
only a longer-lived media URL from Oxy would remove.

## Reading

Oxy mints a short-lived URL (300 s) only for a file whose owner linked it to
Nilo. It does this through Nilo's service token (`files:linked:read`, granted
in Nilo's Oxy application spec). Deciding who may have that URL is Nilo's job.

A file is served on a page only when both of these hold
(`repositories/pageFiles.ts`):

- it was recorded in the page's workspace;
- it was uploaded to that page, or the page's icon, its cover or one of its
  blocks holds it.

The second rule is why a copied or duplicated block, or page, keeps its file. The first
rule is why knowing a file's id is not enough to read it through a page in
another workspace.

A reader asks through whatever gave them the page:

- membership: `POST /pages/:id/files/urls`;
- a share link: `POST /share/:token/files/urls`;
- a published page: `POST /public/pages/:slug/files/urls { pageId? }`.

Each takes `{ ids }` and leaves out the files the reader may not have.

Oxy allows an application 120 mints a minute. So the API keeps each minted URL
in Redis, shared by every task, and hands it out again until a minute before
it expires (`lib/files.ts`). A URL is a credential while it lasts. It is never
logged, cached by a browser (`Cache-Control: no-store`) or persisted offline.

## Exports

A PDF embeds attached images, which the API fetches through minted URLs.
Markdown and HTML name an attachment rather than linking it, because the link
would die within minutes.

## Offline

A URL is never kept across launches. `expo-image` caches each attached image
on disk under its file id (`cacheKey`); when no URL can be minted (offline,
even after a cold start), the app shows that copy
(`Image.getCachePathAsync`, `useFileImageSource`). An image never opened on
this device has no copy and shows its placeholder. On web the browser's own
cache applies.

## Oxy's record of where a file is used

Oxy keeps a reference for every use of a file by an application (Oxy ADR
0043), and tells the owner a file nothing uses is "not in use". Nilo's
references are all of one entity type:

| Entity type | Entity id | Made by | Means |
|---|---|---|---|
| `page` (`NILO_FILE_ENTITY_TYPE`) | the page's id | the file's owner, from their app, with their session (`assets.link`, `app` = `NILO_OXY_APPLICATION_ID`) | the file was uploaded to the page, or the page's properties list it (Noted's attachments) |

The owner's reference is also the grant that lets Oxy mint URLs for the file
to Nilo (ADR 0021): Oxy's `/assets/service/linked-url` serves a file only if a
reference of Nilo's application was made by the file's owner. Nilo's service
token (workload identity) is minted for that same application id, so the
check holds. The app sends the id, not the legacy `'nilo'` alias, because a
session bound to an application is that application whatever it names, and
the shared first-party session resolves an id directly. A reference Nilo
makes with its own token has no creator and grants nothing: Nilo never makes
one of these to stand in for the owner's.

### Letting go

Nilo uses a file on a page while either holds (`db/triggers.ts`):

- a `page_files` row records the file as uploaded to the page. The row
  outlives the page while anything in its workspace still holds the file: a
  block (a copy keeps its file), a page's icon or cover (a duplicate keeps
  them), a kept version (restoring it brings the block
  back), or a page's Yjs document (a change not projected yet). Pages in the
  trash keep their rows: restoring one must find its files.
- the page exists and one of its properties lists the file (a `files`
  property: `{ files: [{ fileId }] }`).

When the last one ends — a `page_files` row deleted (a reset, the daily
sweep), a page deleted for good (empty trash, `?hard=true`, `POST
/notes/erase`, a reset), a file taken out of a page's properties — a trigger
queues the removal in `file_reference_removals` in the same statement, whatever
path did it. Every API task drains the queue every 30 s with Nilo's service
token (`assets.references.remove`, scope `files:references:write`); a removal
Oxy could not be told of waits 1 minute, doubling to 6 hours, and is never
dropped. Removing a reference never deletes or trashes the file: it is the
owner's, and Oxy only marks it "not in use".

Removing a block does not let go of anything by itself: the page it was
uploaded to keeps it, and page history keeps versions whose blocks hold it.

### The daily run

Once a day one task (by lease, `file_reference_runs`) runs `lib/file-references.ts`:

1. lets go of attachments nothing holds any more (above);
2. asks Oxy again about files marked trashed or taken down, in case the event
   that restored one never arrived;
3. forgets file events older than Oxy's 30-day redelivery window;
4. reconciles Nilo's `page` references with what Nilo holds
   (`assets.references.reconcile`, ADR 0043 D6): every `page_files` row with
   its page, and every file a page's properties list. The mode is
   `NILO_FILE_REFERENCES_RECONCILE`: `dry-run` (the default — Oxy counts what
   it would add and remove and changes nothing), `commit`, or `off`. Its
   report is `file_reference_runs.report`.

Reconciliation removes a reference Nilo no longer holds — including the
owner's grant, which nothing can recreate — so it is set to `commit` only
after the dry-run reports have been read. Two guards: the inventory is read 5
minutes after the reconciliation opens, because the app links a file a moment
before it records it and Oxy keeps only references made after the opening;
and it never commits while an attachment names no page (rows recorded before
`0039`, whose page was deleted under the old `ON DELETE SET NULL`): set their
`page_id` from Oxy's `file_references` (application Nilo, entity type `page`)
or delete the row once nothing holds the file — the daily sweep does that by
itself. A pair reconciliation adds (a use with no reference at all) is
recorded as Nilo's, which counts the use but grants no URL.

### File events

Oxy tells Nilo when a file it uses is deleted, moved to its owner's trash,
restored, taken down or put back, or changes visibility, at `POST
/webhooks/oxy/files` (`routes/oxy-file-events.ts`). The body is read raw and
verified with `verifyFileEventSignature` and `OXY_FILES_WEBHOOK_SECRET`; the
endpoint's verification challenge is answered without it. Each event's file
status is recorded (`oxy_file_statuses`), once per event id and never over a
newer one. A file not `active` is not asked for again:
readers get its id in `removed`, and the app says it was removed instead of
showing a placeholder — and never shows the copy it keeps on disk, so a
takedown does not live on in a device cache. A note lists such files in
`removedAttachments` (`/notes`), for Noted to show the same way. A recorded
upload that Oxy serves again is `active` again.
