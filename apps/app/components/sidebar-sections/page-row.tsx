import * as React from 'react';
import { View, type ViewInstance } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { usePageDrag } from './drag-context';
import { SharedPageRow, type PageRowSharedProps } from './shared-page-row';

/** How long a press holds before the row lifts, as a long press elsewhere. */
export const LIFT_AFTER_MS = 350;

/**
 * Native sidebar page row with drag and drop: a long press lifts the row,
 * which follows the finger; where it would land shows on the row under it
 * (before, inside, after: `dropTargetAt`), and lifting the finger drops it
 * there through the same writes as on web (`planSidebarDrop`, in the tree).
 *
 * The pan activates only after the long press, so a tap still opens the page
 * and a swipe still scrolls the sidebar. Gestures run on the JS thread; only
 * the lifted row's offset is animated.
 *
 * Web build resolves `page-row.web.tsx` instead.
 */
export function SidebarPageRow(props: PageRowSharedProps) {
  const { page, enableDrag = true, onDrop } = props;
  const drag = usePageDrag();
  const ref = React.useRef<ViewInstance>(null);
  const lift = useSharedValue(0);

  // The drop handler changes between renders; the registry reads the latest.
  const latest = React.useRef(onDrop);
  latest.current = onDrop;
  const { registerRow, beginDrag, moveDrag, endDrag } = drag;
  React.useEffect(() => {
    if (!enableDrag) return;
    return registerRow(page.id, {
      measure: () =>
        new Promise((resolve) => {
          const node = ref.current;
          if (!node) {
            resolve(null);
            return;
          }
          node.measureInWindow((_x, y, _width, height) => resolve({ y, height }));
        }),
      onDrop: (sourceId, position) => latest.current?.(sourceId, position),
    });
  }, [enableDrag, page.id, registerRow]);

  const pan = Gesture.Pan()
    .runOnJS(true)
    .enabled(enableDrag)
    .activateAfterLongPress(LIFT_AFTER_MS)
    .onStart(() => beginDrag(page.id))
    .onUpdate((e) => {
      lift.value = e.translationY;
      moveDrag(e.absoluteY);
    })
    .onFinalize((_e, success) => {
      lift.value = withTiming(0, { duration: 120 });
      // A pan cancelled (the scroll took the touch) drops nothing.
      endDrag(success);
    });

  const lifted = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value }],
    zIndex: lift.value === 0 ? 0 : 1,
  }));

  const isDragging = drag.draggingId === page.id;
  const dropIndicator = drag.hover?.targetId === page.id ? drag.hover.position : null;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={lifted}>
        {/* Measured for the hit test: where the row sits, not where it is lifted to. */}
        <View ref={ref} collapsable={false}>
          <SharedPageRow
            {...props}
            platformDrag={enableDrag ? { draggable: true, isDragging, dropIndicator } : null}
          />
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

export type { PageRowSharedProps };
