import { useCallback, useSyncExternalStore } from 'react';
import { Pressable, View } from 'react-native';
import { BlockList, type EditorStore } from '@oxy.so/bloom-editor';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiMore2Line } from '@oxy.so/bloom/icons/RiMore2Line';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { runCommand } from '@/lib/editor/run-command';
import {
  addColumn,
  addRow,
  deleteColumn,
  deleteRow,
  ROW,
  toggleHeaderRow,
} from '@/lib/editor/table';
import { useColorScheme } from '@/lib/useColorScheme';
import { cn } from '@/lib/utils';
import { BlockMenuButton } from './block-menu-button';
import type { BlockComponentProps } from './types';

/** Narrowest a cell gets before the table scrolls with the page. */
const MIN_CELL_WIDTH = 72;
/** The handle column beside the rows, and the handle row above the columns. */
const HANDLE = 22;

/** The table's rows and their cells, re-read whenever any of them changes. */
function useGrid(store: EditorStore, tableId: string): { rows: string[]; cells: string[][] } {
  const read = useCallback(() => {
    const doc = store.getSnapshot().doc;
    const table = doc.blocks[tableId];
    if (!table) return '';
    return table.children
      .filter((id) => doc.blocks[id]?.type === ROW)
      .map((id) => `${id}:${(doc.blocks[id]?.children ?? []).join(',')}`)
      .join('|');
  }, [store, tableId]);
  const key = useSyncExternalStore(store.subscribe, read, read);
  const rows: string[] = [];
  const cells: string[][] = [];
  for (const entry of key ? key.split('|') : []) {
    const [row, list] = entry.split(':');
    if (!row) continue;
    rows.push(row);
    cells.push(list ? list.split(',') : []);
  }
  return { rows, cells };
}

/**
 * `table` container: its rows of cells laid out as a grid, the first row
 * tinted when it is a header. An editor adds and removes rows and columns
 * from the handles beside them and the buttons under the table; each change
 * is one undo step that keeps the table's `rows` and `cols` in step.
 */
export function TableBlock({ block, readOnly, renderChildren, store }: BlockComponentProps) {
  if (!store) {
    // Outside an editor nothing lays the cells out but the children renderer.
    return (
      <View className="rounded-md border border-border overflow-hidden my-1 bg-background">
        {renderChildren?.(block.id) ?? null}
      </View>
    );
  }
  return <EditableTable tableId={block.id} store={store} readOnly={readOnly === true} />;
}

function EditableTable({
  tableId,
  store,
  readOnly,
}: {
  tableId: string;
  store: EditorStore;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const { rows, cells } = useGrid(store, tableId);
  const withHeader = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().doc.blocks[tableId]?.props.withHeader === true,
  );
  const columnCount = Math.max(1, ...cells.map((row) => row.length));
  const editing = !readOnly;

  const columnEntries = (index: number) => [
    {
      label: t('editor.blocks.table.insertLeft'),
      onPress: () => runCommand(store, (c) => addColumn(c, tableId, index)),
    },
    {
      label: t('editor.blocks.table.insertRight'),
      onPress: () => runCommand(store, (c) => addColumn(c, tableId, index + 1)),
    },
    { kind: 'separator' as const },
    {
      label: t('editor.blocks.table.deleteColumn'),
      destructive: true,
      disabled: columnCount <= 1,
      onPress: () => runCommand(store, (c) => deleteColumn(c, tableId, index)),
    },
  ];
  const rowEntries = (rowId: string, index: number) => [
    {
      label: t('editor.blocks.table.insertAbove'),
      onPress: () => runCommand(store, (c) => addRow(c, tableId, index)),
    },
    {
      label: t('editor.blocks.table.insertBelow'),
      onPress: () => runCommand(store, (c) => addRow(c, tableId, index + 1)),
    },
    ...(index === 0
      ? [
          {
            kind: 'check' as const,
            label: t('editor.blocks.table.headerRow'),
            checked: withHeader,
            onChange: () => runCommand(store, (c) => toggleHeaderRow(c, tableId)),
          },
        ]
      : []),
    { kind: 'separator' as const },
    {
      label: t('editor.blocks.table.deleteRow'),
      destructive: true,
      disabled: rows.length <= 1,
      onPress: () => runCommand(store, (c) => deleteRow(c, tableId, rowId)),
    },
  ];

  return (
    <View
      className="my-1"
      accessibilityLabel={t('editor.blocks.table.label', { rows: rows.length, cols: columnCount })}
    >
      {editing ? (
        <View className="flex-row" style={{ paddingLeft: HANDLE, height: HANDLE }}>
          {Array.from({ length: columnCount }, (_, index) => (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: a column is its position.
              key={index}
              className="flex-1 items-center justify-center"
              style={{ minWidth: MIN_CELL_WIDTH }}
            >
              <BlockMenuButton
                label={t('editor.blocks.table.columnMenu', { index: index + 1 })}
                entries={columnEntries(index)}
                size={14}
              />
            </View>
          ))}
        </View>
      ) : null}
      {rows.map((rowId, r) => {
        const header = withHeader && r === 0;
        return (
          <View key={rowId} className="flex-row">
            {editing ? (
              <View className="items-center justify-center" style={{ width: HANDLE }}>
                <BlockMenuButton
                  label={t('editor.blocks.table.rowMenu', { index: r + 1 })}
                  entries={rowEntries(rowId, r)}
                  icon={RiMore2Line}
                  size={14}
                />
              </View>
            ) : null}
            <View
              accessibilityRole={header ? 'header' : undefined}
              className={cn(
                'flex-1 flex-row border-x border-b border-border',
                r === 0 && 'border-t rounded-t-md',
                r === rows.length - 1 && 'rounded-b-md',
                header && 'bg-muted',
              )}
            >
              {(cells[r] ?? []).map((cellId, c) => (
                <View
                  key={cellId}
                  className={cn('flex-1 px-2', c > 0 && 'border-l border-border')}
                  style={{ minWidth: MIN_CELL_WIDTH }}
                >
                  <BlockList ids={[cellId]} depth={0} />
                </View>
              ))}
            </View>
          </View>
        );
      })}
      {editing ? (
        <View className="flex-row items-center gap-1 pt-1" style={{ paddingLeft: HANDLE }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('editor.blocks.table.addRow')}
            onPress={() => runCommand(store, (c) => addRow(c, tableId))}
            className="flex-1 flex-row items-center justify-center gap-1 rounded-md py-1 hover:bg-muted active:bg-muted"
          >
            <RiAddLine width={14} height={14} fill={colors.mutedForeground} />
            <Text className="text-xs text-muted-foreground">{t('editor.blocks.table.addRow')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('editor.blocks.table.addColumn')}
            onPress={() => runCommand(store, (c) => addColumn(c, tableId))}
            className="flex-row items-center justify-center gap-1 rounded-md px-2 py-1 hover:bg-muted active:bg-muted"
          >
            <RiAddLine width={14} height={14} fill={colors.mutedForeground} />
            <Text className="text-xs text-muted-foreground">
              {t('editor.blocks.table.addColumn')}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
