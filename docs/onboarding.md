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
The workspace uses `AppShell gutter={0} navigationGap={0}` and the document and
comments use the compositor's `joined` appearance. Their shared Surface,
divider and responsive floating presentation belong to `AppShellPanels`;
`CommentPanel` supplies its own `Screen` header, scroll content and footer.
Opening or closing discussions must preserve the mounted document editor.

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
document editor. The activity panel shows actual metadata and saved content
versions, reusing the existing version preview/restore dialog and access checks.
Content edits refresh that metadata and history on `page:projected`, emitted to
the authorized document room after PostgreSQL commits the projection. A document
update acknowledgement confirms storage of the update, not completion of the
projection; do not substitute a guessed timeout or an optimistic edit date.
Floating panels use the compositor's dismiss control; consult `useAppShellPanel`
before supplying a second close action in a panel's own header.
It is not a complete property-change audit log or analytics implementation.

The editor supplies its toolbar through `Screen.bottomBar` with
`bottomBarKeyboardBehavior="follow"`. Bloom coordinates keyboard avoidance,
focused inputs and toolbar clearance; Nilo does not measure the toolbar or
position it above the keyboard.

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
Import, move and page-history dialogs also delegate their content scrolling to
`Dialog`. Keep result lists and history previews in its content region, with
confirmation and mutation actions in its action slot. A long result list is
not a reason to introduce a second fixed-height scroller.

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
