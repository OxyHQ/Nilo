/**
 * A canvas page: its notes (`canvas_note` blocks) placed on an infinite
 * surface, panned and zoomed, each edited where it sits with the same editor
 * as a document — one store, one undo history, one sync session.
 *
 * Gestures run on the JS thread; only the view's transform is animated.
 */
import { BlockList, EditorSurface, type EditorSurfaceProps } from '@oxy.so/bloom-editor';
import type { BlockId, EditorStore } from '@oxy.so/bloom-editor/model';
import { Maximize, Minus, Plus, StickyNote, Trash2 } from 'lucide-react-native';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Button } from '@oxy.so/bloom/button';
import { ButtonGroup, ButtonGroupItem } from '@oxy.so/bloom/button-group';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import {
  addNote,
  appendToNote,
  frameOf,
  isNote,
  moveNote,
  type NoteFrame,
  removeNote,
  resizeNote,
  toCanvas,
} from '@/lib/editor/canvas';
import { useColorScheme } from '@/lib/useColorScheme';

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;
const ORIGIN_MARGIN = 48;
const clampZoom = (scale: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));

/** The view of the canvas: where its origin is on screen, and how large. */
export interface CanvasView {
  x: number;
  y: number;
  scale: number;
}

/** A screen point (relative to the canvas's frame) on the canvas. */
export function toCanvasPoint(view: CanvasView, point: { x: number; y: number }) {
  return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
}

/** Zoom to `scale` keeping `focus` (a screen point) where it is. */
export function zoomAround(view: CanvasView, scale: number, focus: { x: number; y: number }) {
  const next = clampZoom(scale);
  const ratio = next / view.scale;
  return {
    scale: next,
    x: focus.x - (focus.x - view.x) * ratio,
    y: focus.y - (focus.y - view.y) * ratio,
  };
}

/** The view that shows every note, with a margin, at most at 100%. */
export function fitView(
  frames: readonly (NoteFrame & { height: number })[],
  size: { width: number; height: number },
): CanvasView {
  if (frames.length === 0 || size.width === 0)
    return { x: ORIGIN_MARGIN, y: ORIGIN_MARGIN, scale: 1 };
  const left = Math.min(...frames.map((f) => f.x));
  const top = Math.min(...frames.map((f) => f.y));
  const right = Math.max(...frames.map((f) => f.x + f.width));
  const bottom = Math.max(...frames.map((f) => f.y + f.height));
  const scale = clampZoom(
    Math.min(
      1,
      (size.width - ORIGIN_MARGIN * 2) / Math.max(1, right - left),
      (size.height - ORIGIN_MARGIN * 2) / Math.max(1, bottom - top),
    ),
  );
  return {
    scale,
    x: (size.width - (right - left) * scale) / 2 - left * scale,
    y: ORIGIN_MARGIN - top * scale,
  };
}

type SurfaceProps = Omit<EditorSurfaceProps, 'children' | 'style'>;

export function PageCanvas(props: SurfaceProps & { store: EditorStore; readOnly: boolean }) {
  const { store, readOnly } = props;
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const root = useSyncExternalStore(store.subscribe, () => store.getSnapshot().doc.root);
  const notes = root.filter((id) => isNote(store.doc, id));
  // Blocks outside a note (written while the page was a document, or while it
  // is being turned back into one) are shown as they are, never moved by
  // looking at them: only the member's own switch wraps them.
  const loose = root.filter((id) => !isNote(store.doc, id));

  const x = useSharedValue(ORIGIN_MARGIN);
  const y = useSharedValue(ORIGIN_MARGIN);
  const scale = useSharedValue(1);
  const [zoom, setZoom] = useState(1);
  const size = useRef({ width: 0, height: 0 });
  const heights = useRef(new Map<BlockId, number>());
  const viewNow = (): CanvasView => ({ x: x.value, y: y.value, scale: scale.value });
  /** Show `view`; the zoom label follows unless a gesture is still moving it. */
  const setView = useCallback(
    (view: CanvasView, label = true) => {
      x.value = view.x;
      y.value = view.y;
      scale.value = view.scale;
      if (label) setZoom(view.scale);
    },
    [x, y, scale],
  );
  const currentScale = useCallback(() => scale.value, [scale]);

  const createAt = (point: { x: number; y: number }) => {
    if (readOnly) return;
    store.sealHistory();
    store.run((c) => addNote(c, point));
  };

  // One finger pans; two pinch, and the pinch alone moves the view then, from
  // where it began, so the two never add up.
  const panStart = useRef({ x: 0, y: 0, scale: 1 });
  const pinchStart = useRef({ x: 0, y: 0, scale: 1 });
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(2)
    .maxPointers(1)
    .onStart(() => {
      panStart.current = viewNow();
    })
    .onUpdate((e) => {
      x.value = panStart.current.x + e.translationX;
      y.value = panStart.current.y + e.translationY;
    });
  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => {
      pinchStart.current = viewNow();
    })
    .onUpdate((e) =>
      setView(
        zoomAround(pinchStart.current, pinchStart.current.scale * e.scale, {
          x: e.focalX,
          y: e.focalY,
        }),
        false,
      ),
    )
    .onEnd(() => setZoom(scale.value));
  const doubleTap = Gesture.Tap()
    .runOnJS(true)
    .numberOfTaps(2)
    .onEnd((e) => createAt(toCanvasPoint(viewNow(), { x: e.x, y: e.y })));
  const background = Gesture.Simultaneous(pan, pinch, doubleTap);

  // The mouse wheel on the web: scroll pans, with Ctrl or ⌘ it zooms at the pointer.
  const frame = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const element = frame.current as unknown as HTMLElement | null;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const view = { x: x.value, y: y.value, scale: scale.value };
      if (event.ctrlKey || event.metaKey) {
        const box = element.getBoundingClientRect();
        const focus = { x: event.clientX - box.left, y: event.clientY - box.top };
        setView(zoomAround(view, view.scale * Math.exp(-event.deltaY / 300), focus));
      } else {
        x.value = view.x - event.deltaX;
        y.value = view.y - event.deltaY;
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [x, y, scale, setView]);

  const plane = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  const zoomBy = (factor: number) => {
    const { width, height } = size.current;
    setView(zoomAround(viewNow(), scale.value * factor, { x: width / 2, y: height / 2 }));
  };
  const fit = () =>
    setView(
      fitView(
        notes.map((id) => ({ ...frameOf(store.doc, id), height: heights.current.get(id) ?? 120 })),
        size.current,
      ),
    );
  const newNoteInView = () => {
    const { width, height } = size.current;
    createAt(toCanvasPoint(viewNow(), { x: width / 2 - 180, y: height / 3 }));
  };

  return (
    <EditorSurface {...props} style={styles.surface}>
      <View
        ref={frame}
        style={[styles.frame, { backgroundColor: colors.muted }]}
        onLayout={(e) => {
          size.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
        }}
        accessibilityLabel={t('editor.canvas.label')}
      >
        <GestureDetector gesture={background}>
          <View style={StyleSheet.absoluteFill} />
        </GestureDetector>
        <Animated.View style={[styles.plane, plane]} pointerEvents="box-none">
          {loose.length > 0 ? <LooseBlocks ids={loose} store={store} readOnly={readOnly} /> : null}
          {notes.map((id) => (
            <CanvasNote
              key={id}
              id={id}
              store={store}
              readOnly={readOnly}
              scale={currentScale}
              heights={heights.current}
            />
          ))}
        </Animated.View>
        {root.length === 0 ? (
          <View style={styles.empty} pointerEvents="none">
            <EmptyState
              variant="compact"
              title={t(readOnly ? 'editor.canvas.emptyReadOnly' : 'editor.canvas.empty')}
            />
          </View>
        ) : null}
        <View style={styles.controls}>
          <ButtonGroup size="sm">
            <ButtonGroupItem
              iconOnly
              accessibilityLabel={t('editor.canvas.zoomOut')}
              onPress={() => zoomBy(1 / 1.25)}
              renderLeadingIcon={({ size, color }) => <Minus size={size} color={color} />}
            />
            <ButtonGroupItem
              accessibilityLabel={t('editor.canvas.resetZoom')}
              onPress={() => setView({ ...viewNow(), scale: 1 })}
            >
              {`${Math.round(zoom * 100)}%`}
            </ButtonGroupItem>
            <ButtonGroupItem
              iconOnly
              accessibilityLabel={t('editor.canvas.zoomIn')}
              onPress={() => zoomBy(1.25)}
              renderLeadingIcon={({ size, color }) => <Plus size={size} color={color} />}
            />
            <ButtonGroupItem
              iconOnly
              accessibilityLabel={t('editor.canvas.fit')}
              onPress={fit}
              renderLeadingIcon={({ size, color }) => <Maximize size={size} color={color} />}
            />
            {!readOnly ? (
              <ButtonGroupItem
                iconOnly
                accessibilityLabel={t('editor.canvas.newNote')}
                onPress={newNoteInView}
                renderLeadingIcon={({ size, color }) => <StickyNote size={size} color={color} />}
              />
            ) : null}
          </ButtonGroup>
        </View>
      </View>
    </EditorSurface>
  );
}

/** Blocks outside any note: shown where they are, framed, until put into one. */
function LooseBlocks({
  ids,
  store,
  readOnly,
}: {
  ids: readonly BlockId[];
  store: EditorStore;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View
      style={[styles.note, { left: 0, top: 0, width: 640 }]}
      className="rounded-xl border border-dashed border-border bg-background px-4 pb-4 pt-2"
    >
      <View className="flex-row items-center justify-between gap-2">
        <Text className="text-xs text-muted-foreground">{t('editor.canvas.loose')}</Text>
        {!readOnly ? (
          <Button
            appearance="plain"
            tone="neutral"
            size="xs"
            onPress={() => {
              store.sealHistory();
              store.run(toCanvas);
            }}
          >
            {t('editor.canvas.putInNote')}
          </Button>
        ) : null}
      </View>
      <BlockList ids={ids} depth={0} />
    </View>
  );
}

/** How far the keyboard or a screen reader moves or widens a note at a time. */
const NUDGE = 40;

/** One note where it sits: moved by its header, resized at its right edge. */
const CanvasNote = memo(function CanvasNote({
  id,
  store,
  readOnly,
  scale,
  heights,
}: {
  id: BlockId;
  store: EditorStore;
  readOnly: boolean;
  scale: () => number;
  heights: Map<BlockId, number>;
}) {
  const { t } = useTranslation();
  const block = useSyncExternalStore(store.subscribe, () => store.getSnapshot().doc.blocks[id]);
  const frame = frameOf(store.doc, id);
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const dw = useSharedValue(0);

  // A drag's offset is let go once the note is drawn where it was dropped,
  // not before, so it never shows back at its old place for a frame.
  const drawnAt = useRef(frame);
  useLayoutEffect(() => {
    if (drawnAt.current.x !== frame.x || drawnAt.current.y !== frame.y) {
      dx.value = 0;
      dy.value = 0;
    }
    if (drawnAt.current.width !== frame.width) dw.value = 0;
    drawnAt.current = frame;
  });

  const moveTo = (to: { x: number; y: number }) => {
    if (Math.round(to.x) === frame.x && Math.round(to.y) === frame.y) {
      dx.value = 0;
      dy.value = 0;
      return;
    }
    store.sealHistory();
    store.run((c) => moveNote(c, id, to));
  };
  const widen = (width: number) => {
    if (Math.round(width) === frame.width) {
      dw.value = 0;
      return;
    }
    store.sealHistory();
    store.run((c) => resizeNote(c, id, width));
  };

  const move = Gesture.Pan()
    .runOnJS(true)
    .enabled(!readOnly)
    .onUpdate((e) => {
      dx.value = e.translationX / scale();
      dy.value = e.translationY / scale();
    })
    .onEnd(() => moveTo({ x: frame.x + dx.value, y: frame.y + dy.value }));
  const resize = Gesture.Pan()
    .runOnJS(true)
    .enabled(!readOnly)
    .onUpdate((e) => {
      dw.value = e.translationX / scale();
    })
    .onEnd(() => widen(frame.width + dw.value));

  const placed = useAnimatedStyle(() => ({
    transform: [{ translateX: dx.value }, { translateY: dy.value }],
    width: frame.width + dw.value,
  }));

  if (!block) return null;
  const empty = block.children.length === 0;
  return (
    <Animated.View
      style={[styles.note, { left: frame.x, top: frame.y }, placed]}
      className="rounded-xl border border-border bg-background shadow-sm"
      onLayout={(e) => heights.set(id, e.nativeEvent.layout.height)}
    >
      <View className="flex-row items-center justify-between px-2 pt-1">
        <GestureDetector gesture={move}>
          <View
            accessible={!readOnly}
            accessibilityRole="adjustable"
            accessibilityLabel={t('editor.canvas.moveNote')}
            accessibilityActions={[
              { name: 'moveLeft', label: t('editor.canvas.moveLeft') },
              { name: 'moveRight', label: t('editor.canvas.moveRight') },
              { name: 'moveUp', label: t('editor.canvas.moveUp') },
              { name: 'moveDown', label: t('editor.canvas.moveDown') },
            ]}
            onAccessibilityAction={(event) => {
              if (readOnly) return;
              const by = {
                moveLeft: { x: -NUDGE, y: 0 },
                moveRight: { x: NUDGE, y: 0 },
                moveUp: { x: 0, y: -NUDGE },
                moveDown: { x: 0, y: NUDGE },
              }[event.nativeEvent.actionName];
              if (by) moveTo({ x: frame.x + by.x, y: frame.y + by.y });
            }}
            className="h-5 flex-1 cursor-grab items-center justify-center"
          >
            <View className="h-1 w-10 rounded-full bg-border" />
          </View>
        </GestureDetector>
        {!readOnly ? (
          <Button
            appearance="subtle"
            tone="neutral"
            size="xs"
            iconOnly
            accessibilityLabel={t('editor.canvas.deleteNote')}
            onPress={() => {
              store.sealHistory();
              store.run((c) => removeNote(c, id));
            }}
            renderLeadingIcon={({ size, color }) => <Trash2 size={size} color={color} />}
          />
        ) : null}
      </View>
      <View className="px-4 pb-4">
        <BlockList ids={block.children} depth={0} />
        {empty && !readOnly ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('editor.canvas.writeInNote')}
            onPress={() => {
              store.sealHistory();
              store.run((c) => appendToNote(c, id));
            }}
            className="py-2"
          >
            <Text className="text-sm text-muted-foreground">{t('editor.canvas.writeInNote')}</Text>
          </Pressable>
        ) : null}
      </View>
      {!readOnly ? (
        <GestureDetector gesture={resize}>
          <View
            accessibilityRole="adjustable"
            accessibilityLabel={t('editor.canvas.resizeNote')}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'increment') widen(frame.width + NUDGE);
              if (event.nativeEvent.actionName === 'decrement') widen(frame.width - NUDGE);
            }}
            style={styles.resize}
            className="cursor-ew-resize"
          />
        </GestureDetector>
      ) : null}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  surface: { flex: 1 },
  frame: { flex: 1, overflow: 'hidden', position: 'relative' },
  plane: { position: 'absolute', left: 0, top: 0, transformOrigin: '0 0' },
  note: { position: 'absolute' },
  resize: { position: 'absolute', right: -4, top: 12, bottom: 12, width: 8 },
  controls: { position: 'absolute', right: 16, bottom: 16 },
  empty: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
