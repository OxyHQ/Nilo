# Nilo database title and breadcrumb

The previous database capture shows `Projects` twice in the header: once as the current breadcrumb and once as the editable page title. This change leaves the editable title as the single visible name and keeps the current breadcrumb as a down-chevron control. Its accessible name remains `Projects`; it still opens IdentityPopover and the authorized sibling menu. The separate leading icon continues to open the icon picker.

## Verification

- Browser: Google Chrome for Testing 156.0.8078.4, DPR 1.
- Nilo source base: `7efb84d99da743412c6292e05e1be21d2edd7ace`; the report records the exact uncommitted diff.
- Consumer package versions: Bloom 17.31.0, app-preset 6.6.0.
- The offline fixture captured 17 frames at 1440, 1024, 768, 390, and 320 CSS pixels, including empty database and document states. It reported no browser errors or unexpected requests.
- Runtime assertions confirm the breadcrumb has no visible title text, the editable title is present once, ArrowDown opens the authorized `Planning` neighbor and moves real focus to it, and Escape restores focus to the breadcrumb.
- The search draft and input node survive 390 → 320 → 1440; the toolbar's tested keyboard stops remain inside their scroll clips at 320.
- `database-breadcrumb.test.tsx` and `database-page.test.tsx`: 15 tests passed.

Evidence: [runtime report](report.json), [1440px](database-populated-1440.png), [320px](database-populated-320.png), [empty database](database-empty-1440.png), [document](document-1440.png), [selection and toolbar captures](editor-selection-390.png).

Comparison: [previous 1440px capture](../after/database-populated-1440.png).
