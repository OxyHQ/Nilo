# Nilo developer onboarding

Nilo is a Bun monorepo with an Expo client and an Express API.

```text
apps/app  -> HTTPS and Socket.IO -> apps/api -> PostgreSQL
```

Redis/Valkey is optional in development; in production it carries Socket.IO
across tasks and shared rate limits. Attachments live in Oxy's file manager
(`docs/files.md`). Neither replaces PostgreSQL.

## Boundaries

Nilo owns workspace data and collaboration. It does not execute providers,
store provider keys, expose chat completions, or maintain a model catalogue.
One-shot product operations use `Nilo -> Oxy -> Kaana`; conversations,
memory, tools and agents use `Nilo -> Alia -> Oxy -> Kaana`. Nilo never
calls Kaana directly, and provider credentials exist only in Kaana's encrypted
PostgreSQL database.

The inference-boundary tests deliberately include positive fixtures. If one of
the forbidden constructs is introduced, the detector must name it rather than
passing because it scanned nothing.

## Important paths

| Path | Purpose |
|---|---|
| `apps/api/src/index.ts` | API boot and route mounts |
| `apps/api/src/db/schema/` | current PostgreSQL schema |
| `apps/api/src/drizzle/` | immutable migration history |
| `apps/app/lib/api/` | authenticated API client and route constants |
| `apps/app/app/` | Expo Router screens |

## UI composition

Bloom owns the workspace layout. `NiloShell` supplies navigation and workspace
actions to `AppShell` and `Sidebar`; individual routes compose their surfaces
with `AppShellPanels` and `Screen`. Do not put a surface around the entire
router outlet: a document and its comments are sibling panels.
The workspace inherits AppShell's normal outer gutter and navigation gap;
do not flatten the panel against the viewport to imitate a reference header.
The document and comments use the compositor's `joined` appearance. Their shared
Surface, divider and responsive floating presentation belong to `AppShellPanels`;
`CommentPanel` supplies its own `Screen` header, scroll content and footer.
The group's `header` slot spans the document and its adjacent panels inside
that same Surface. Keep the editor toolbar in the document's own `Screen`;
do not offset side panels with a guessed header height. Opening or closing
discussions must preserve the mounted document editor and header overlays.

`PageHeader` owns header placement and measures its accessory (view tabs and
`Toolbar`). `ScreenScrollView` binds content to that screen's scroll owner.
Boards and canvases use `Screen scroll="none"` so their own viewport fills the
remaining space. Database pagination uses `ScreenScrollView.onEndReached`.

Navigation uses `PageHeader presentation="navigation"`: Bloom owns its height,
insets and contextual control density without changing the normal `md` size.
Overlays start their own density scope. The header breadcrumb represents the
authorized page ancestry returned by the API. For database rows,
`usePageBreadcrumbPath` first verifies access to the database, then includes its
authorized parent pages and the database link. A row grant alone must not reveal
the database or its parents. Do not prepend a workspace-home link: guests may only have access to the
page, and workspace switching already belongs to the sidebar. Supply real
`href` destinations for every authorized ancestor to `Breadcrumb overflow="collapse"`.
Bloom owns fitting, truncation and the menu for hidden ancestors; Nilo must not
pre-filter the path, render its own ellipsis or measure header widths.
Keep the current page visible while its ancestry loads, protect optimistic
metadata during saves, and refresh affected paths when another session changes
the hierarchy. Breadcrumb queries include their
workspace scope so those events do not invalidate unrelated editor data.
Those events refresh exact page-metadata queries in the same workspace, keeping
title, icon, cover and lock state consistent with the header. Pending page
and database mutations defer that refresh until settlement; blocks and Yjs remain untouched.
The editable current item uses `BreadcrumbItem.trigger` with Bloom's
`PopoverTrigger`, preserving the same measured button and responsive renderer.
`IdentityPopover` supplies only name/icon mutation behavior: Enter or outside
dismissal saves, Escape cancels, and a failed save retains the draft for retry.
Opening the existing icon picker waits for a successful name save.
Each breadcrumb also supplies `hoverMenu.content({ open })` to Bloom. Its
DropdownMenu owns hover intent, keyboard navigation, primary-click coexistence,
the current-destination marker and scrolling. `BreadcrumbNeighbors` requests only
the hovered resource's authorized neighbors while open; it must not derive
siblings from cached workspace lists. See [navigation neighbors](navigation-neighbors.md)
for pagination, access and cursor semantics. Neighbor queries are memory-only and
recheck access before exposing a cached response on reopening.

Page-link and child-page blocks compose Expo Router's `Link asChild` with Bloom's
`LinkButton`. The router owns activation and Bloom owns the visible control,
icon slot, typography and truncation. Keep a real `href`; a bare `router.push`
callback loses modified-click behavior, while an uncoordinated `href` and
callback can navigate twice. Do not duplicate modifier-key handling in Nilo.

Header actions use Bloom's `PageHeader.actions` callback and its `compact` state.
Nilo forwards that state to sharing and keeps favorites in the page actions menu
when the direct star is hidden. Bloom owns the header-width decision; Nilo must
not measure it or duplicate its breakpoint. Keep the actions tree stable so
changing presentation preserves an open sharing dialog and the editor.
Comments use Bloom's normal icon-only button with an accessible unresolved count.
The header's `spacious` state controls the edited-time shortcut, without a second
viewport calculation in Nilo. Its HoverCard shows creation/edit metadata and its
primary action opens an activity panel declared beside the document in the same
compositor. The actions menu keeps activity reachable at narrower sizes.
Comments and activity are mutually exclusive; switching them preserves the
document editor. Current creation/edit metadata remains available to readers in
the header HoverCard. The activity panel uses Bloom's `ActivityFeed` inside its
`ScreenScrollView`, with actor profiles, localized times and committed change
records supplied by Nilo. Its records come from the paginated page-activity API;
saved block snapshots are not feed events. Do not invent entries for changes
before activity capture was installed, or substitute view analytics for edits.

Activity values and saved versions require the page's effective editor role in
both API and client. The shared history owner hides them during a permission
recheck, cancels pending reads and retires cached data after denial or downgrade.
Keep these query families in memory only. A failed next-page request preserves
an already authorized feed; a permission denial retires it. Snapshot-specific
404s do not invalidate unrelated activity or create a permission-refetch loop.

Property changes use the display schema captured with the event, never today's
property type or option labels. Historical schema is returned only to readers of
the database; a grant to one row alone must not disclose its field names. Missing
historical context, including relation destinations, uses a generic change
description rather than resolving a guessed target. See [Page activity](page-activity.md)
for persistence owners, capture scope and the additive migration contract.

Content edits refresh metadata, activity and versions on `page:projected`, emitted to
the authorized document room after PostgreSQL commits the projection. A document
update acknowledgement confirms storage of the update, not completion of the
projection; do not substitute a guessed timeout or an optimistic edit date.
Metadata changes use the existing workspace invalidation events. Realtime carries
invalidation IDs, never historical field values; every read rechecks access.
Floating panels use the compositor's dismiss control; consult `useAppShellPanel`
before supplying a second close action in a panel's own header.

The editor supplies its toolbar through `Screen.bottomBar` with
`bottomBarKeyboardBehavior="follow"`. Bloom coordinates keyboard avoidance,
focused inputs and toolbar clearance; Nilo does not measure the toolbar or
position it above the keyboard.

Block transformations belong to Bloom Editor's commands. Apply the final type
and properties together, including toggle-heading variants, so child ownership
and undo reflect one operation. Nilo must not reconstruct block trees to work
around a shared transformation defect. Whole-block Cut must preserve content
when the supported clipboard format cannot reconstruct the complete selection
or when writing fails. A pending removal must recheck the mounted editor's
current edit capability; Cut also rechecks the copied subtree and its location
after confirmation so a collaborative change is never deleted uncopied.
Nilo supplies localized feedback through
`onClipboardError`; the editor owns selection, clipboard validation and undo.
Plain-text/Markdown copying does not establish lossless rich-block clipboard
support. Attachment identities remain subject to Nilo's file-reference rules.

Alia's chat sheet uses the SDK's Bloom `BottomSheet` composition and keeps
content-driven height. The sheet and Screen compositor must communicate their
intrinsic sizing and available-space limit; do not replace auto-sizing with
`sizing="fill"` to work around a collapsed flex layout. Fill is for deliberately
full-height surfaces. Do not introduce app-owned viewport heights or keyboard
offsets. Verify the main and conversation sheets grow and shrink with content,
scroll only at their available-height limit, and retain draft and focus during
resize.

An embedded database uses `AppShellPanels scope="local"` with a vertical
`split`, document flow and a declarative panel height. Its `ProjectBoard`
owns the horizontal deck and column scrolling. Grouped boards pass lanes to
the same component; no viewport measurement belongs in the app.

Sidebar onboarding uses Bloom's `Sidebar.onboarding` slot. Nilo supplies
localized steps, role-appropriate actions and completion derived from workspace
data.

Page icons use Bloom's existing `EmojiPicker` with `embedded` and
`scrollable={false}` inside `Dialog`. The dialog owns the sole surface and scroll
region; the shared picker owns emoji search, categories and tone selection.
Nilo supplies its catalog, icon/upload tabs, authorization and persistence.

The application establishes `BloomScope size="md"` above its overlay outlet.
Normal sizing belongs to Bloom's family recipes; do not shrink the whole app
or add local padding overrides to compensate for a component that ignores the
scope. Preserve Bloom's shared `Surface` material and rounded presentation.

Page actions use `DropdownMenu` with appearance and export submenus. Their
content must not introduce a fixed-height `ScrollView` inside the floating
surface. Missing viewport or scroll behavior must be implemented in Bloom's
own container. Apply the same ownership rule to other menus and popovers.
Mixed action/form popovers use `PopoverItem` for their action rows and let
`PopoverContent` own overflow, including when switching to view settings.
Comment mention suggestions also use the popover's scroll owner; keep typing
in the non-modal composer instead of wrapping the suggestions in a second scroller.

The editor's slash catalog supplies translated labels, descriptions, search terms,
actions and an `icon` component through Bloom Editor's React `SlashMenuItem` adapter.
The platform-free `SlashItem` model remains presentation-free. Use existing Bloom
icon components without local width, color, padding or decorative wrappers;
`leading` remains available for caller-owned custom nodes such as avatars and
does not imply styling arbitrary React elements. Bloom's `SuggestionList` owns
the row, icon slot, selection and scrolling. Keep command ids and actions stable
when the locale changes, and do not build another suggestion renderer or scroll
engine in Nilo.

Bloom's [UI architecture](https://github.com/OxyHQ/Bloom/blob/main/docs/ui-architecture.mdx)
is the shared architectural contract for consumer work; its adoption matrix
distinguishes requirements from implemented coverage.

Page covers use `CoverHeader`, including its own change-cover and reposition
actions. Nilo resolves authorized media and supplies picker and persistence
callbacks; it does not wrap these buttons in another painted container.
`CoverFill` represents colors and gradients, and read-only cover displays use
the same renderer. Cover width is independent of the document's text column.
Bloom owns crop geometry, drag/keyboard interaction, draft position and
save/cancel. Nilo converts the normalized position to its persisted 0–100 scale
and returns the save promise so a failure stays visible in Bloom's editor.
The cover picker composes Bloom's `Dialog`, `ResponsiveGrid` and pressable
`Card` options. Its gallery uses the dialog's scroll owner, including on narrow
screens; do not add fixed-height scrollers around individual tabs.
Import and move dialogs also delegate their content scrolling to `Dialog`.
Keep their result lists in its content region and mutation actions in its action
slot. A long result list is not a reason to introduce a second fixed-height scroller.

Page history uses `Dialog presentation="fullscreen" scrollable={false}` with
`AppShellPanels scope="local" appearance="plain"` to inherit the dialog Surface
without painting a second one. The version list and block
preview are genuinely independent regions, each with its own `Screen` and
`ScreenScrollView`; the outer dialog must not add another scroll owner. Bloom
owns viewport sizing and responsive collapse. On narrow containers, selecting a
version shows its preview and Back returns to the list. Restore review stays in
the compositor, preserving the selected preview and placing confirmation actions
in the review screen's `bottomBar`. Failures retain the selection for retry.
Listing, previewing and restoring all require the canonical editor permission,
including a final check for stale restore callbacks. A snapshot contains blocks,
not historical icon, cover, properties or discussions; do not label the latest
snapshot as the current page without evidence. See [Page history](page-history.md).

## Reference behavior

Compare interactions as well as screenshots. Review the authenticated reference
in Windows Chrome when working in WSL, including hover, click, keyboard, touch,
loading, failed saves and resize while an overlay is open. Use disposable Nilo
fixtures for mutations; do not change the reference workspace. Product parity
status belongs in [issue #132](https://github.com/OxyHQ/Nilo/issues/132), not in
an assumption that adopting a shared visual component supplies its persistence.

These official references guide behavior; the Nilo requirements below define
what an implementation must preserve rather than claim every feature is present.

| Area | Reference and Nilo integration contract |
| --- | --- |
| Navigation and views | [Database views](https://www.notion.com/help/views-filters-and-sorts) distinguish view settings, filters, sorting and grouping. Keep authorized page/database ancestry separate from workspace navigation; changing a view must not invent a new database or discard row content. |
| Boards | [Boards](https://www.notion.com/help/boards) support moving cards within and across columns. Use Bloom's existing interaction engine. Persistent manual ordering needs an explicit relationship to view sorts, filters, multi-value groups and pagination; sorting only the currently loaded cards is insufficient. |
| Search | [Workspace search](https://www.notion.com/help/search) supports quoted phrases. Preserve the query's intended terms and order. Apply canonical access rules before the final result limit; inaccessible higher-ranked matches must not crowd out accessible results. |
| Activity | [Page analytics](https://www.notion.com/help/page-analytics) and [version history](https://www.notion.com/help/duplicate-delete-and-restore-content) describe different capabilities. Creation/edit timestamps, saved block versions, property-change events and view analytics must remain truthful about which records exist. |
| Recovery | [Deleted properties and version restore](https://www.notion.com/help/duplicate-delete-and-restore-content) require distinct recovery paths. A block snapshot is not a schema/value backup. A future property restore must preserve property identity and row values transactionally, and respect concurrent schema changes. |
| Collaboration | [Comments and mentions](https://www.notion.com/help/comments-mentions-and-reminders) cover page discussions, anchored threads and reopening resolved threads. Bloom owns presentation; Nilo owns anchors, membership, notifications and permission checks. |
| Export | [Content export](https://www.notion.com/help/export-your-content) distinguishes database CSV data from page bodies and included subpages. An archive must traverse the authorized hierarchy, retain row-page content and usable local links, and reject limits explicitly rather than silently omit content. Signed remote attachment URLs are not bundled offline files. |
| Offline | [Offline behavior](https://www.notion.com/help/guides/working-offline-in-notion-everything-you-need-to-know) includes reconnecting and syncing local edits. Keep the existing document/session owner and distinguish locally retained edits from server-confirmed persistence; a closed editor must not be the only way pending work can eventually synchronize. |

## Setup

```bash
bun install
cp apps/api/.env.example apps/api/.env
cp apps/app/.env.example apps/app/.env
bun run dev:api
bun run dev:app
```

## Gates

```bash
bun run lint
bun run --filter @nilo/api test
NILO_TEST_DATABASE_URL=postgres://nilo:nilo@127.0.0.1:5439/postgres \
  bun run --filter @nilo/api test:pgdb
bun run build:api
EXPO_PUBLIC_API_URL=https://api.example.test bun run build:app
```

See [deployment status](deployment.md) before changing a release workflow.
