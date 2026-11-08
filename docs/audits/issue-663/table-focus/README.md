# Horizontal table owner candidate

The table now composes Bloom ScrollArea instead of a raw Animated.ScrollView.
A module-scope RN Animated.createAnimatedComponent wrapper keeps the existing
Animated.event binding, native-driver selection and frozen-column translateX.
It does not introduce Reanimated handlers, route breakpoints or local focus logic.

Chromium 1248, synthetic account/API fixtures, 300 ms after genuine Tab navigation:

| Width | Before Effort bounds | After Effort bounds | Viewport |
| --- | --- | --- | --- |
|390|292..467|215..390|0..390|
|320|292..467|145..320|0..320|

Before is the published 17.19.3 baseline at 8128. After uses the isolated packaged
Bloom #675 source candidate 48b98ac5 at 8138; its manifest version is 17.22.0, not a
published acceptance. Both tests keep document scroll unchanged. A real horizontal
wheel moves 100 px; ordinary columns move with it. Separate pinned-column cases
at 320/390 retain header x0 while scrollLeft becomes 100. These cases verify the
existing frozen-column transform, not visibility beneath overlapping frozen cells.

The existing view-settings regression now dispatches a scroll and asserts the
frozen-column Animated.Value reaches 73. All 20 suite tests and app typecheck pass
with the local mirror restored to published 17.19.3. No dependency version changed.
The shared focus fix is still required: final acceptance must update to published
17.23, re-run this browser fixture and verify device behavior in the existing native
validation window. Server 8138 was stopped and its mirror restored after capture;
baseline 8128 was not restarted or changed.

Run scripts/verify-table-focus-browser.mjs with NILO_ROOT, MENTION_ROOT,
NILO_ORIGIN, CHROME_PATH and BASELINE_OUTPUT. TABLE_EXPECT_VISIBLE=0 records the
old failing bounds; TABLE_PINNED=1 separately checks the frozen transform under
real wheel input. All requests remain local/synthetic.
