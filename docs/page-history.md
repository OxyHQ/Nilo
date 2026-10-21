# Page version history

Page history uses Bloom's fullscreen Dialog and local AppShellPanels with the
plain group appearance. The group inherits the Dialog's Surface instead of
painting a second material behind the joined columns.
The versions rail and content preview are separate Screen scroll regions; the
outer Dialog does not add a third scroller. Bloom owns viewport sizing, panel
collapse, focus and dismissal. Narrow containers show the version list first;
choosing a version opens its preview, whose Back action returns to the list.
The Activity header opens the version list; activity records and saved versions
are separate data and are not assumed to have a one-to-one correspondence.

Version rows show an exact local date/time and the author resolved through the
public member-profile owner. A page-only guest editor does not need workspace
membership to resolve an author's display name. Missing profiles use the
localized unknown-member label. The latest saved snapshot is not called the
current version: more recent edits may not have produced a snapshot yet.

Begin restore replaces the versions rail with a restore review while keeping the
selected preview mounted and visible beside it on desktop. On narrow screens,
the review occupies the panel and Cancel returns to the selected preview.
Screen and PageFooter keep confirmation actions reachable without another
overlay or a consumer-defined fixed-height scroller.
Restoration requires effective editor access and a successful idle access
check, including when an old confirmation callback survives a permission
change. Failed saves keep the selection and allow retry; repeated submission
while the same request is pending cannot send a second mutation. Success closes
history and returns to the page. The history query owner masks and retires
historical caches after access downgrade; current page metadata remains visible.

Only saved block content is previewed and restored. The API saves the current
blocks before replacing them, allowing another restore. Page properties, icon,
cover and discussions are not historical metadata in these snapshots. They are
not painted into a preview as if they belonged to that earlier version.

## Reference and limits

The [official Notion history documentation](https://www.notion.com/help/duplicate-delete-and-restore-content)
and authenticated Windows Chrome were inspected on 2026-10-21 without changing
reference content. The desktop reference uses a fullscreen version rail and
preview, followed by a separate restore review. Its documented mobile flow
selects a version before previewing it. Nilo reuses Bloom's responsive panel
contract for those regions rather than duplicating Notion's layout engine.

Notion also offers highlighted changes, grouping, bookmarks/named versions,
shareable version URLs and broader database/property restoration. Those are
separate data and product capabilities; this UI does not invent controls or
claim those behaviors are implemented by a block snapshot.
