# Horizontal table owner and published acceptance

The table now composes Bloom ScrollArea instead of a raw Animated.ScrollView.
A module-scope RN Animated.createAnimatedComponent wrapper keeps the existing
Animated.event binding, native-driver selection and frozen-column translateX.
It does not introduce Reanimated handlers, route breakpoints or local focus logic.

Chromium 1248, synthetic account/API fixtures, 300 ms after genuine Tab navigation:

| Width | Before Effort bounds | After Effort bounds | Viewport |
| --- | --- | --- | --- |
|390|292..467|215..390|0..390|
|320|292..467|145..320|0..320|

Before is the published 17.19.3 baseline at 8128. The initial candidate used the
isolated packaged Bloom #675 source candidate 48b98ac5 at 8138; its manifest
version was 17.22.0, not a published acceptance. Both tests kept document scroll
unchanged. A real horizontal wheel moved 100 px; ordinary columns moved with it.
Separate pinned-column cases at 320/390 retained header x0 while scrollLeft became
100. These cases verify the existing frozen-column transform, not visibility
beneath overlapping frozen cells.

## Published 17.24.0 rerun

The final run uses source `bb56fcd2b241afcd857adcc147e4c9fc8f859fc3`, published
Bloom 17.24.0, app-preset 6.6.0 and Chromium 146 on synthetic local fixtures.
At 320px, Tab moves the Effort header fully into the table clip (x=145..320); at
390px it lands at x=215..390. A 100px horizontal wheel moves the table while the
outer document stays fixed. The report and screenshots are in
`../published-17.24.0/table-focus/`. This is published web evidence, not native
device verification. The pinned-header measurements above remain from the
candidate run; they have not been rerun against the published package.

The existing view-settings regression now dispatches a scroll and asserts the
frozen-column Animated.Value reaches 73. All 20 suite tests and app typecheck pass
with the local mirror restored to published 17.19.3. No dependency version changed.
The published web focus acceptance is complete. Native device behavior remains
unverified. Server 8138 was stopped and its mirror restored after capture; baseline
8128 was not restarted or changed.

Run scripts/verify-table-focus-browser.mjs with NILO_ROOT, MENTION_ROOT,
NILO_ORIGIN, CHROME_PATH and BASELINE_OUTPUT. TABLE_EXPECT_VISIBLE=0 records the
old failing bounds; TABLE_PINNED=1 separately checks the frozen transform under
real wheel input. All requests remain local/synthetic.
