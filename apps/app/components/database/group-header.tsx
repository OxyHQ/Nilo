import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { RiArrowDownLine } from '@oxy.so/bloom/icons/RiArrowDownLine';
import { RiArrowDownSLine } from '@oxy.so/bloom/icons/RiArrowDownSLine';
import { RiArrowRightSLine } from '@oxy.so/bloom/icons/RiArrowRightSLine';
import { RiArrowUpLine } from '@oxy.so/bloom/icons/RiArrowUpLine';
import { RiEyeOffLine } from '@oxy.so/bloom/icons/RiEyeOffLine';
import { RiMoreLine } from '@oxy.so/bloom/icons/RiMoreLine';
import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useUpdateView } from '@/lib/hooks/use-database-views';
import { move, place } from '@/lib/list-order';
import { useCollapsedGroupsStore } from '@/lib/stores/collapsed-groups-store';
import { useColorScheme } from '@/lib/useColorScheme';
import {
  type Database,
  type DatabaseProperty,
  type DatabaseRow,
  type DatabaseView,
  type DateGroupGranularity,
  type GroupRange,
  NAME_PROPERTY_ID,
  type PropertyValue,
  type RowGroup,
  type ViewConfig,
  type ViewGroupKey,
} from '@/lib/types/databases';
import {
  groupProperty,
  groupValue,
  numberGroupingOf,
  type RowSection,
  rowSections,
} from '@/lib/view-groups';
import { useGroupLabel } from './group-label';
import { PersonChips } from './person-cell';
import { SELECT_CHIP_HUE } from './select-color';

/** The drag payload of a group's header (web): its key, as JSON (null for the empty group). */
const GROUP_DRAG_TYPE = 'application/x-nilo-group';

/** A group as its header shows it: an option's chip, people's chips, else its label. */
export function GroupBadge({
  property,
  groupKey,
  label,
}: {
  property: DatabaseProperty;
  groupKey: string | null;
  label: string;
}) {
  const option =
    groupKey === null ? undefined : property.config?.options?.find((o) => o.id === groupKey);
  if (option) {
    return (
      <Chip size="xs" hue={SELECT_CHIP_HUE[option.color] ?? 'neutral'}>
        {option.name}
      </Chip>
    );
  }
  if (
    groupKey !== null &&
    (property.type === 'person' ||
      property.type === 'created_by' ||
      property.type === 'last_edited_by')
  ) {
    return <PersonChips userIds={[groupKey]} />;
  }
  return <Text className="text-sm font-medium text-foreground">{label}</Text>;
}

/** What whoever may change the view does to a group from its header. */
export interface GroupActions {
  onMove: (by: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onHide: () => void;
  /** Another group's header dropped on this one (web): it takes this one's place. */
  onDropGroup: (key: ViewGroupKey) => void;
}

export interface GroupHeaderProps {
  property: DatabaseProperty;
  groupKey: string | null;
  granularity?: DateGroupGranularity;
  /** A number range's bounds, which name it. */
  range?: GroupRange;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  /** The view's editors': move and hide the group. */
  actions?: GroupActions;
}

/**
 * A group's header in a table, a list, a gallery, a timeline or a board's
 * sub-groups: collapses it, names it and counts its rows. Whoever may change
 * the view moves it up or down and hides it from its menu (everywhere), or
 * drags it onto another group's header (web).
 */
export function GroupHeader({
  property,
  groupKey,
  granularity,
  range,
  count,
  collapsed,
  onToggle,
  actions,
}: GroupHeaderProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const label = useGroupLabel(property, granularity)(groupKey, range);
  const Chevron = collapsed ? RiArrowRightSLine : RiArrowDownSLine;
  const web = Platform.OS === 'web' && actions !== undefined;
  // Web-only: the header is dragged onto another group's to take its place.
  const dragSource = web
    ? {
        draggable: true,
        onDragStart: (e: { dataTransfer: DataTransfer }) => {
          e.dataTransfer.setData(GROUP_DRAG_TYPE, JSON.stringify(groupKey));
          e.dataTransfer.effectAllowed = 'move';
        },
      }
    : {};
  const dropTarget = web
    ? {
        onDragOver: (e: { preventDefault: () => void; dataTransfer: DataTransfer }) => {
          if (e.dataTransfer.types.includes(GROUP_DRAG_TYPE)) e.preventDefault();
        },
        onDrop: (e: { preventDefault: () => void; dataTransfer: DataTransfer }) => {
          const raw = e.dataTransfer.getData(GROUP_DRAG_TYPE);
          if (!raw) return;
          e.preventDefault();
          const dropped: unknown = JSON.parse(raw);
          if (dropped === null || typeof dropped === 'string') actions?.onDropGroup(dropped);
        },
      }
    : {};
  return (
    <View
      className="flex-row items-center gap-1 pr-2 hover:bg-muted/40"
      {...(dropTarget as Record<string, unknown>)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        accessibilityLabel={t(collapsed ? 'databases.groups.expand' : 'databases.groups.collapse', {
          name: label,
        })}
        accessibilityHint={web ? t('databases.groups.drag', { name: label }) : undefined}
        onPress={onToggle}
        className="flex-1 flex-row items-center gap-2 px-3 py-2"
        {...(dragSource as Record<string, unknown>)}
      >
        <Chevron width={14} height={14} fill={colors.mutedForeground} />
        <GroupBadge property={property} groupKey={groupKey} label={label} />
        <Text className="text-xs text-muted-foreground">
          {t('databases.groups.count', { count })}
        </Text>
      </Pressable>
      {actions ? <GroupActionsMenu actions={actions} label={label} /> : null}
    </View>
  );
}

/** Product actions shared by Bloom's board lanes and other grouped views. */
export function GroupActionsMenu({ actions, label }: { actions: GroupActions; label: string }) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          iconOnly
          appearance="plain"
          size="xs"
          accessibilityLabel={t('databases.groups.options', { name: label })}
          leadingIcon={RiMoreLine}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" label={t('databases.groups.options', { name: label })}>
        <DropdownMenuItem
          disabled={!actions.canMoveUp}
          leading={<RiArrowUpLine width={14} height={14} fill={colors.foreground} />}
          onPress={() => actions.onMove(-1)}
        >
          {t('databases.groups.moveUp')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!actions.canMoveDown}
          leading={<RiArrowDownLine width={14} height={14} fill={colors.foreground} />}
          onPress={() => actions.onMove(1)}
        >
          {t('databases.groups.moveDown')}
        </DropdownMenuItem>
        <DropdownMenuItem
          leading={<RiEyeOffLine width={14} height={14} fill={colors.foreground} />}
          onPress={actions.onHide}
        >
          {t('databases.groups.hide')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const sameKeys = (a: readonly ViewGroupKey[], b: readonly ViewGroupKey[]) =>
  a.length === b.length && a.every((key, i) => key === b[i]);

/** The row a section adds: in its group, with the group's value (`groupValue`). */
export interface NewRowInput {
  databaseId: string;
  title?: string;
  properties?: Record<string, PropertyValue>;
}

/**
 * A grouped view's sections (a table's, a list's, a gallery's or a
 * timeline's by `groupBy`, a board's lanes by `subGroupBy`) and what their
 * headers show and do: which are collapsed, toggled; moved up or down or
 * dropped on another (`config.groupOrder`); hidden (`config.hiddenGroups`).
 * Whoever may change the view (`editable`) saves all of it to the view, for
 * every reader; a reader's collapsing stays on their device
 * (`useCollapsedGroupsStore`), over the view's own. What is changed shows at
 * once, while it is saved. Numbers grouped by the ranges the API chose keep
 * them once a group of them is named (`config.numberGrouping`): a range's key
 * is its index, which would otherwise name another range once the numbers
 * spread. `sections` is null when the view is not grouped.
 */
export function useGroupedSections(
  database: Database,
  view: DatabaseView,
  rows: readonly DatabaseRow[],
  groups: readonly RowGroup[] | undefined,
  hasMore: boolean,
  by: 'groupBy' | 'subGroupBy',
  editable: boolean,
): {
  grouping: DatabaseProperty | null;
  sections: RowSection[] | null;
  isCollapsed: (key: ViewGroupKey) => boolean;
  headerProps: (section: RowSection) => GroupHeaderProps;
  newRowIn: (section: RowSection) => NewRowInput;
} {
  const groupBy = view[by];
  const grouping = groupProperty(database.schema.properties, groupBy);
  const hideEmpty = groupBy?.hideEmpty;
  const { groupOrder, hiddenGroups } = view.config ?? {};
  const sections = React.useMemo(
    () =>
      grouping && groups
        ? rowSections(rows, groups, { groupOrder, hiddenGroups }, { hideEmpty, complete: !hasMore })
        : null,
    [grouping, groups, rows, groupOrder, hiddenGroups, hideEmpty, hasMore],
  );
  const shown = React.useMemo(() => sections?.map((section) => section.key) ?? [], [sections]);
  const { isCollapsed, toggle, actionsFor } = useViewGroups(
    database.id,
    view,
    editable,
    groups,
    shown,
  );
  const headerProps = (section: RowSection): GroupHeaderProps => ({
    property: grouping as DatabaseProperty,
    groupKey: section.key,
    granularity: groupBy?.granularity,
    range: section.range,
    count: section.count,
    collapsed: isCollapsed(section.key),
    onToggle: () => toggle(section.key),
    actions: actionsFor(section.key),
  });
  const newRowIn = (section: RowSection): NewRowInput => {
    const value = grouping ? groupValue(grouping, section.key, section.range) : undefined;
    return {
      databaseId: database.id,
      ...(grouping?.id === NAME_PROPERTY_ID && section.key !== null && { title: section.key }),
      ...(grouping && value !== undefined && { properties: { [grouping.id]: value } }),
    };
  };
  return { grouping, sections, isCollapsed, headerProps, newRowIn };
}

function useViewGroups(
  databaseId: string,
  view: DatabaseView,
  editable: boolean,
  groups: readonly RowGroup[] | undefined,
  shown: readonly ViewGroupKey[],
): {
  isCollapsed: (key: ViewGroupKey) => boolean;
  toggle: (key: ViewGroupKey) => void;
  /** The header's actions for a group among those shown, in order. */
  actionsFor: (key: ViewGroupKey) => GroupActions | undefined;
} {
  const { t } = useTranslation();
  const updateView = useUpdateView();
  const local = useCollapsedGroupsStore((state) => state.byView[view.id]);
  const generation = useCollapsedGroupsStore((state) => state.generation);
  const setLocal = useCollapsedGroupsStore((state) => state.setCollapsed);
  const saved = view.config?.collapsedGroups ?? [];
  // An editor's collapsing, until the view holds it.
  const [pending, setPending] = React.useState<{
    base: readonly ViewGroupKey[];
    keys: ViewGroupKey[];
  } | null>(null);
  const collapsed: readonly ViewGroupKey[] = editable
    ? pending && sameKeys(pending.base, saved)
      ? pending.keys
      : saved
    : (local ?? saved);

  const save = (config: Partial<ViewConfig>) => {
    const ranges = view.config?.numberGrouping ? undefined : numberGroupingOf(groups ?? []);
    updateView.mutate(
      {
        databaseId,
        viewId: view.id,
        config: { ...view.config, ...(ranges && { numberGrouping: ranges }), ...config },
      },
      { onError: () => toast.error(t('databases.views.updateFailed')) },
    );
  };

  const toggle = (key: ViewGroupKey) => {
    const next = collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key];
    if (!editable) {
      // This only guards the reader's local preference, not editor mutations.
      if (generation !== useCollapsedGroupsStore.getState().generation) return;
      setLocal(view.id, next);
      return;
    }
    setPending({ base: saved, keys: next });
    save({ collapsedGroups: next });
  };

  const actionsFor = (key: ViewGroupKey) => {
    if (!editable) return undefined;
    const index = shown.indexOf(key);
    const reorder = (order: ViewGroupKey[] | null) => {
      if (order) save({ groupOrder: order });
    };
    return {
      canMoveUp: index > 0,
      canMoveDown: index >= 0 && index < shown.length - 1,
      onMove: (by: -1 | 1) => reorder(move(shown, index, index + by)),
      // Dropped where this one was, this one moving aside.
      onDropGroup: (dropped: ViewGroupKey) =>
        reorder(place(shown, dropped, key, shown.indexOf(dropped) < index ? 'after' : 'before')),
      onHide: () =>
        save({ hiddenGroups: [...new Set([...(view.config?.hiddenGroups ?? []), key])] }),
    };
  };

  return { isCollapsed: (key) => collapsed.includes(key), toggle, actionsFor };
}
