# Nilo workspace — Bloom 17.50.0

Captured 2026-11-10 from Nilo main source plus this worktree's Bloom 17.50.0
dependency update. Chromium desktop, DPR 1, English locale, synthetic account/API
fixtures and an offline seeded Yjs document. Every request was intercepted;
unmatched requests were aborted. The run captured 17 viewport/interaction states
with no browser errors and no unexpected external requests. See
[`report.json`](report.json) and the screenshots in this directory.

The 320px keyboard pass reached New view, Search, Filter, Sort, Add property,
New, Row templates, and the Effort table header inside their scroll clips. Arrow
Down from the Projects breadcrumb focused Planning; Escape restored focus. The
search draft and the same input DOM node survived 390 → 320 → 1440 resizing.
The run also records editor selection toolbar and Tab/Shift+Tab observations.

This is browser evidence only. It does not establish iOS, Android, native
keyboard, contrast, large-text, or release-performance acceptance, and does not
cover every criterion of Bloom #663 or the separate editor issue #434. iPhone
validation remains deferred as requested.

Reproduce with `scripts/capture-workspace-browser.mjs` as described in the
parent [audit](../README.md). The app was served on port 8130 because 8128 was
already occupied. Bloom resolves to 17.50.0, the newest published version
accepted by Nilo's current Bloom Editor peer range.
