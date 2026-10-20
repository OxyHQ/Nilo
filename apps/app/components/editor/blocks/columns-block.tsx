import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { type LayoutChangeEvent, Platform, Pressable, View } from 'react-native';
import { appendChild, BlockList, type EditorStore } from '@oxy.so/bloom-editor';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import {
  addColumn,
  COLUMN,
  columnShares,
  MAX_COLUMNS,
  removeColumn,
  resizeShares,
  setColumnShares,
} from '@/lib/editor/columns';
import { runCommand } from '@/lib/editor/run-command';
import { cn } from '@/lib/utils';
import { BlockMenuButton } from './block-menu-button';
import type { BlockComponentProps } from './types';

/** Narrower than this, columns stack: side by side they would be unreadable. */
const STACK_BELOW = 480;
/** The gap between two columns, which is also where a divider is dragged. */
const GAP = 16;

interface ColumnView {
  id: string;
  children: string[];
  ratio: number | undefined;
}

/** The layout's columns, their blocks and their ratios, re-read when any changes. */
function useColumns(store: EditorStore, columnsId: string): ColumnView[] {
  const read = useCallback(() => {
    const doc = store.getSnapshot().doc;
    return JSON.stringify(
      (doc.blocks[columnsId]?.children ?? [])
        .map((id) => doc.blocks[id])
        .filter((block) => block?.type === COLUMN)
        .map((block) => [
          block?.id,
          block?.children,
          typeof block?.props.ratio === 'number' ? block.props.ratio : null,
        ]),
    );
  }, [store, columnsId]);
  const key = useSyncExternalStore(store.subscribe, read, read);
  return (JSON.parse(key) as [string, string[], number | null][]).map(([id, children, ratio]) => ({
    id,
    children,
    ratio: ratio ?? undefined,
  }));
}

/**
 * `columns` container: its columns side by side, each as wide as its share
 * (`ratio`), stacked on a narrow screen. An editor adds and removes columns
 * from each column's menu, and on the web drags the gap between two columns
 * to give one more of the width; the shares are stored when the drag ends.
 */
export function ColumnsBlock({ block, readOnly, renderChildren, store }: BlockComponentProps) {
  if (!store) {
    return (
      <View className="flex-row flex-wrap items-stretch gap-1 my-1">
        {renderChildren?.(block.id) ?? null}
      </View>
    );
  }
  return <ColumnsLayout columnsId={block.id} store={store} readOnly={readOnly} />;
}

function ColumnsLayout({
  columnsId,
  store,
  readOnly,
}: {
  columnsId: string;
  store: EditorStore;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const columns = useColumns(store, columnsId);
  const stored = columnShares(columns.map((column) => column.ratio));
  const [dragging, setDragging] = useState<number[] | null>(null);
  const [width, setWidth] = useState(0);
  const shares = dragging && dragging.length === stored.length ? dragging : stored;
  const stacked = width > 0 && width < STACK_BELOW;
  const latestShares = useRef(stored);
  latestShares.current = stored;

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  /** A divider dragged `dx` points: the two columns beside it trade width. */
  const usable = width - GAP * Math.max(0, columns.length - 1);
  const resized = (index: number, dx: number) =>
    resizeShares(latestShares.current, index, usable > 0 ? dx / usable : 0);

  const entries = (column: ColumnView, index: number) => [
    {
      label: t('editor.blocks.columns.addLeft'),
      disabled: columns.length >= MAX_COLUMNS,
      onPress: () => runCommand(store, (c) => addColumn(c, columnsId, index - 1)),
    },
    {
      label: t('editor.blocks.columns.addRight'),
      disabled: columns.length >= MAX_COLUMNS,
      onPress: () => runCommand(store, (c) => addColumn(c, columnsId, index)),
    },
    { kind: 'separator' as const },
    {
      label: t('editor.blocks.columns.remove'),
      destructive: true,
      onPress: () => runCommand(store, (c) => removeColumn(c, columnsId, column.id)),
    },
  ];

  return (
    <View
      onLayout={onLayout}
      className={cn('my-1', stacked ? 'gap-3' : 'flex-row items-stretch')}
      accessibilityLabel={t('editor.blocks.columns.label', { count: columns.length })}
    >
      {columns.map((column, index) => (
        <View
          key={column.id}
          className={stacked ? undefined : 'flex-row'}
          style={stacked ? undefined : { flex: shares[index] ?? 1, minWidth: 0 }}
        >
          <View className="min-w-0 flex-1">
            {readOnly ? null : (
              <View className="flex-row justify-end opacity-60 hover:opacity-100">
                <BlockMenuButton
                  label={t('editor.blocks.columns.menu', { index: index + 1 })}
                  entries={entries(column, index)}
                  size={14}
                />
              </View>
            )}
            {column.children.length > 0 ? (
              <BlockList ids={column.children} depth={0} />
            ) : readOnly ? null : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('editor.blocks.columns.empty')}
                onPress={() => runCommand(store, (c) => appendChild(c, column.id, 'paragraph'))}
                className="rounded-md border border-dashed border-border px-2 py-3"
              >
                <Text className="text-xs text-muted-foreground">
                  {t('editor.blocks.columns.empty')}
                </Text>
              </Pressable>
            )}
          </View>
          {!stacked && index < columns.length - 1 ? (
            <ColumnDivider
              label={t('editor.blocks.columns.resize')}
              active={Platform.OS === 'web' && !readOnly}
              onMove={(dx) => setDragging(resized(index, dx))}
              onEnd={(dx) => {
                setDragging(null);
                if (dx === 0) return;
                const final = resized(index, dx);
                runCommand(store, (c) => setColumnShares(c, columnsId, final));
              }}
            />
          ) : null}
        </View>
      ))}
    </View>
  );
}

/**
 * The gap after a column. On the web an editor drags it (`dx` from where the
 * drag began); elsewhere, and for readers, it is only space.
 */
function ColumnDivider({
  label,
  active,
  onMove,
  onEnd,
}: {
  label: string;
  active: boolean;
  onMove: (dx: number) => void;
  onEnd: (dx: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const drag = Gesture.Pan()
    .runOnJS(true)
    .enabled(active)
    .onUpdate((event) => onMove(event.translationX))
    .onEnd((event) => onEnd(event.translationX));
  if (!active) return <View style={{ width: GAP }} />;
  return (
    <GestureDetector gesture={drag}>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        className="items-center cursor-col-resize"
        style={{ width: GAP }}
      >
        <View
          className={cn('w-0.5 flex-1 rounded-full', hovered ? 'bg-primary/60' : 'bg-transparent')}
        />
      </View>
    </GestureDetector>
  );
}
