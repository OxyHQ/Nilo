# Files

Attachments (uploaded images and files) live in Oxy's file manager, as every
Oxy app's files do (Oxy ADR 0021). Nilo stores no file and runs no bucket.

## Uploading

The member's app does three things (`apps/app/lib/files/upload-page-file.ts`):

1. It uploads the file to Oxy with the member's own session, as `private`.
   The member owns the file in Oxy, and it counts against their Oxy storage.
2. It links the file to Nilo: `app` is Nilo's application id
   (`NILO_OXY_APPLICATION_ID` in `@nilo/contracts`), with the page as the entity.
3. It records the file on the page: `POST /pages/:id/files { fileId, name }`
   (an editor of the page). The API asks Oxy for a URL. That is how it learns
   the file is linked to Nilo by its owner, and its type and size as Oxy
   measured them. It writes a `page_files` row and answers with a first URL.

A block holds the file's id (`content.fileId`), never a URL. A pasted URL
still goes in `content.url`.

## Reading

Oxy mints a short-lived URL (300 s) only for a file whose owner linked it to
Nilo. It does this through Nilo's service token (`files:linked:read`, granted
in Nilo's Oxy application spec). Deciding who may have that URL is Nilo's job.

A file is served on a page only when both of these hold
(`repositories/pageFiles.ts`):

- it was recorded in the page's workspace;
- it was uploaded to that page, or one of the page's blocks holds it.

The second rule is why a copied or duplicated block keeps its file. The first
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

## Removing a block keeps the file

Removing a block does not delete the file in Oxy, deliberately: page
history keeps versions whose blocks hold it, and restoring one must find it.
Oxy also lets only a file's owner unlink it, so Nilo could not do it for a
member who removes someone else's block.
