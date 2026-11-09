# Nilo workspace composition — issue 663

Observed 2026-11-08 on Chromium, DPR 1, en-US, published Bloom 17.19.3,
app-preset 6.5.1, Bloom Editor 0.7.2. Source base is
`e8c0cfd4a89bc3f494827cfce912ebc31f8a4d66`; [artifact hashes](artifacts.json)
identify the changed source and captured files. These are development browser
observations using synthetic account/API responses and an offline seeded Yjs
document. Every external request is intercepted; unmatched requests are aborted.
No production data was read or written. Device/native execution is not covered.

## Corrected transformer diagnosis

The prior [Bloom baseline](https://github.com/OxyHQ/Bloom/pull/668) reproduced
`attempted to use private field on non-instance` in Noxcturnal 0.1.11 with Expo
Metro 58.0.21, without React Compiler. That source/transformed evidence remains
valid. Nilo's actual activation came from tracked `apps/app/app.config.js`,
which explicitly set the experiment true in development. Its app.json applies
only app-preset's withOxyUpdates subplugin, not its main configuration plugin.
Thus the shared default correction in [Oxy #2228](https://github.com/OxyHQ/oxy/pull/2228)
protects main-plugin consumers; updating the package alone did not change Nilo.

The normal registry install resolved app-preset 6.5.1. Removing Nilo's explicit
activation leaves `experiments: { typedRoutes: true }` and uses Expo's default
Babel path. [Configuration observation](expo-config-experiments.json).
The [minimal explicit Noxcturnal probe](transformer/report.json) still fails:
this delivery does not claim to fix the experimental transformer itself.

## Before and after

| State | Desktop | Narrow |
| --- | --- | --- |
| Database before | [1440](before/database-populated-1440.png) | [320](before/database-populated-320.png), [390](before/database-populated-390.png) |
| Database after | [1440](after/database-populated-1440.png) | [320](after/database-populated-320.png), [390](after/database-populated-390.png) |
| Empty database | [1440](after/database-empty-1440.png) | |
| Document | [1440](after/document-1440.png) | [390](after/document-390.png) |
| Empty document | [1440](after/document-empty-1440.png) | [390](after/document-empty-390.png) |
| Dark database | [1440](dark/database-populated-1440.png) | [390](dark/database-populated-390.png) |

[Before report](before/report.json), [after report](after/report.json),
[dark report](dark/report.json). Every final run has no browser errors and no
unexpected external requests. Intermediate diagnostic failures are not included
as successful captures. There are 9 before frames, 17 after frames, and 9 dark
frames; the return to 1440 reuses the raster filename and has a separate report
entry. The earlier blocked transformer snapshot remains in Bloom's baseline.

The first table boundary moves from y=249 to 173 at desktop and from y=273 to
197 at 390 (76 CSS pixels recovered; DPR 1 screenshots). The after report also
measures the first column header at y=174/198 and the unified toolbar at 52px
high. Previously the view toolbar, tools toolbar and count occupied separate
bands. Views, add-view and tools now share one Toolbar with New in its persistent
actions slot. Count/loading status belongs to Screen's bottom bar.

A single joined AppShellPanels panel now owns the database's Surface, matching
the document composition. No sidebar source, theme recipe or table cell density
was changed. There is no new breakpoint or app-owned scroll container.

The specific comparison reference is the database-tabs screenshot captured from
[Notion's views documentation](https://www.notion.com/help/views-filters-and-sorts),
recorded in Bloom's baseline artifacts with SHA-256
`1b03a6b0c20157078bf9d4323e0bcbe479fd388bc2ba926423e598b10441a85d`.
It establishes title → one views/tools/New band → table hierarchy. Intentional
differences: Bloom's approved yellow semantic palette, rounded material, sidebar,
outer gutter and shared control geometry remain. Narrow tools scroll while New
stays visible. Reference raster pixels have unknown source DPR; no pixel parity
or exact font-size equivalence is claimed. The optional
[design canvas](https://superdesign.dev/teams/2d7d9628-2d97-4a08-945f-cd0fd7939bfc/projects/9319e866-ce44-48b5-b260-d81794da01ec)
is a source-derived composition study, not browser evidence or implementation.

## Behavior and limits

- Database viewport sequence 1440 → 1024 → 768 → 390 → 320 → 1440 keeps document
  width equal to viewport width. The table retains its separate horizontal content.
- A search draft and the exact input DOM node survive 390 → 320 → 1440.
- At 320, actual Tab traversal reaches New view, Search, Filter, Sort,
  Add property, New and Row templates. In this historical 17.19.3 capture,
  **full visibility was not established:**
  after 300ms settling per Tab, Search occupies x=188.48–220.48 and Sort
  x=158.27–226.19, while the scroll clip ends at x=201.80. Both remain partially
  clipped despite being inside the browser viewport. A real horizontal wheel
  delta of 50 moves Search to x=138.48–170.48, fully inside the clip. See
  [focused Search](after/database-search-focus-320.png) and
  [after wheel](after/database-search-wheel-320.png).
- Read-only, editor permissions, view URL selection and settings remain covered
  by the database test suites. These renderer tests stub only the compositor's
  DOM observer boundary; the captures exercise the real compositor.
- Document selection and Tab/Shift+Tab observations are recorded in the after
  report and editor-selection images. **Bloom #434 is still pending:** these
  probes do not establish keyboard entry into every formatting control, stable
  Apply targeting, remote edits/read-only cancellation, undo, virtual anchor
  collision handling, or native/link href behavior. No editor source changed.
- The separate table limitation in the old package baseline was that focus could
  land on the Effort column outside the visible horizontal viewport at 320.
  Its repair and published-package acceptance are recorded below.
- Dark captures are visual observations, not contrast certification. Physical
  Android, iPhone, large text, native keyboard and release performance are not
  established by these browser captures. iPhone validation is deferred by user.

## Published Bloom 17.24.0 acceptance

On 2026-11-09, reran both browser harnesses against published Bloom 17.24.0 and
app-preset 6.6.0 from source `bb56fcd2b241afcd857adcc147e4c9fc8f859fc3`, using
Chromium 146, DPR 1, synthetic account/API responses and the offline seeded Yjs
document. The workspace run captured 17 frames with no browser errors or
unexpected requests. Search draft and DOM identity survive 390 → 320 → 1440;
all tested visible toolbar stops fit their scroll clip at 320, and horizontal
wheel input scrolls the toolbar without losing the draft. The full report and
captures are in [published workspace evidence](published-17.24.0/workspace/).

The separate table-focus run captured 320px and 390px with no browser errors or
unexpected requests. Tab reaches the Effort header fully inside the horizontal
clip at both widths (320: x=145..320; 390: x=215..390); a 100px horizontal wheel
moves the table while document scroll remains unchanged. See
[table-focus report and captures](published-17.24.0/table-focus/). This proves
published web behavior only; it does not establish native focus or Android
device behavior.

## Reproduction

Start the normal Metro server from apps/app with explicit fixture origins:

```sh
EXPO_PUBLIC_API_URL=https://nilo-fixture.invalid \
EXPO_PUBLIC_OXY_API_URL=https://api.oxy.so \
EXPO_PUBLIC_OXY_CLIENT_ID=fixture-nilo \
BROWSER=none bunx expo start --web --port 8128
```

From the repository root, with Playwright installed in the indicated tool host:

```sh
INTERACTIONS=1 NILO_ROOT="$PWD" MENTION_ROOT=/path/to/playwright-tool-host \
CHROME_PATH=/path/to/chrome BASELINE_OUTPUT=/tmp/nilo-after \
node scripts/capture-workspace-browser.mjs
```

Use `THEME=dark` for dark captures. The baseline run omits INTERACTIONS and uses
the pre-composition source with only the dependency/configuration correction.
The harness is a manual browser audit tool, not an extra CI test script.

Validation: app typecheck; 27 database suites / 158 tests; repository lint (pre-existing warnings
remain); check:ci-wiring; normal production `build:app` export with explicit HTTPS
fixture origin. The generated sitemap date is restored after build.
