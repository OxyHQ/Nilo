import * as React from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { RiArrowLeftSLine } from '@oxy.so/bloom/icons/RiArrowLeftSLine';
import { RiArrowRightSLine } from '@oxy.so/bloom/icons/RiArrowRightSLine';
import { Button } from '@oxy.so/bloom/button';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import type { Database, DatabaseRow, DatabaseView, RowGroup } from '@/lib/types/databases';
import { dayOf, readDateValue } from '@/lib/date-values';
import { useVisibleDatesStore } from '@/lib/stores/visible-dates-store';
import { groupProperty, rowSections, sectionOptions } from '@/lib/view-groups';
import { visibleDatesFilter } from '@/lib/visible-dates';
import { GroupHeader, useViewGroups } from './group-header';
import { useOpenRow } from './open-row';

interface ViewTimelineProps {
  database: Database;
  view: DatabaseView;
  rows: DatabaseRow[];
  isLoading: boolean;
  /** A grouped timeline's groups, its swimlanes, in order (`GET …/rows`). */
  groups?: RowGroup[];
  /** May change the view: move, hide and collapse its swimlanes for every reader. */
  viewEditable?: boolean;
}

const DAY_WIDTH = 28;
export const DAYS_WINDOW = 60;
/** How far the arrows move the window: four weeks, so a week either side stays in sight. */
const STEP_DAYS = 28;
const DAY_MS = 86_400_000;

/**
 * Timeline view — Gantt-style, on web and native. Reads a `startPropertyId`
 * (and optional `endPropertyId`) date property and lays out a bar per row
 * over `DAYS_WINDOW` days, scrolled sideways; the arrows move the window and
 * only the rows whose bar meets it are read (`useVisibleDatesStore`). A
 * date's own end, with no end property, ends its bar. Grouped (`groupBy`),
 * the bars come in collapsible swimlanes, one per group with its count.
 */
export function ViewTimeline({
  database,
  view,
  rows,
  isLoading,
  groups,
  viewEditable = false,
}: ViewTimelineProps) {
  const openRow = useOpenRow();
  const viewGroups = useViewGroups(database.id, view, viewEditable, groups);
  const grouping = groupProperty(database.schema.properties, view.groupBy);
  // Every row of the dates shown is read: each lane is whole.
  const lanes =
    grouping && groups
      ? rowSections(rows, groups, {
          hideEmpty: view.groupBy?.hideEmpty,
          complete: true,
          ...sectionOptions(view),
        })
      : null;
  const laneKeys = lanes?.map((lane) => lane.key) ?? [];
  const { t, locale } = useTranslation();
  const { width } = useWindowDimensions();
  // A phone keeps most of its width for the bars.
  const titleWidth = width < 640 ? 120 : 240;
  const [windowStart, setWindowStart] = React.useState(() => defaultWindowStart());
  const windowEnd = addDays(windowStart, DAYS_WINDOW);

  const startProperty = React.useMemo(() => {
    const id = view.config.startPropertyId;
    if (id) {
      const p = database.schema.properties.find((x) => x.id === id);
      if (p?.type === 'date') return p;
    }
    return database.schema.properties.find((p) => p.type === 'date') ?? null;
  }, [database.schema.properties, view.config.startPropertyId]);

  const endProperty = React.useMemo(() => {
    const id = view.config.endPropertyId;
    if (!id) return null;
    const p = database.schema.properties.find((x) => x.id === id);
    return p?.type === 'date' ? p : null;
  }, [database.schema.properties, view.config.endPropertyId]);

  // The rows read are those whose bar meets the window shown.
  const show = useVisibleDatesStore((state) => state.show);
  const startPropertyId = startProperty?.id;
  const endPropertyId = endProperty?.id;
  const windowTime = windowStart.getTime();
  React.useEffect(() => {
    if (!startPropertyId) return;
    const from = new Date(windowTime);
    show(
      view.id,
      visibleDatesFilter({
        startPropertyId,
        endPropertyId,
        from,
        to: addDays(from, DAYS_WINDOW),
      }),
    );
  }, [endPropertyId, show, startPropertyId, view.id, windowTime]);

  if (isLoading) {
    return (
      <View className="py-10 items-center">
        <Loading variant="spinner" />
      </View>
    );
  }

  if (!startProperty) {
    return (
      <EmptyState
        // icon: TimerReset
        variant="compact"
        title={t('databases.timeline.needsDateProperty')}
      />
    );
  }

  const gridWidth = DAY_WIDTH * DAYS_WINDOW;
  const barsOf = (list: readonly DatabaseRow[]) =>
    list.flatMap((row) => {
      const span = rowSpan(row, startProperty.id, endProperty?.id ?? null);
      if (!span || span.end < windowStart || span.start > windowEnd) return [];
      const offsetDays = Math.max(0, Math.round((span.start.getTime() - windowTime) / DAY_MS));
      // Cut where the window ends, as where it starts.
      const lastDay = Math.min(
        DAYS_WINDOW - 1,
        Math.round((span.end.getTime() - windowTime) / DAY_MS),
      );
      return [{ row, offsetDays, spanDays: Math.max(1, lastDay - offsetDays + 1) }];
    });
  const bars = barsOf(rows);

  const renderBars = (list: ReturnType<typeof barsOf>, keyPrefix: string) =>
    list.map(({ row, offsetDays, spanDays }) => {
      const title = row.title || t('databases.untitled');
      return (
        <View
          key={`${keyPrefix}${row.id}`}
          className="flex-row border-b border-border/60"
          style={{ height: 36, minWidth: gridWidth + titleWidth }}
        >
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={title}
            onPress={() => openRow(row.id)}
            style={{ width: titleWidth }}
            className="px-3 justify-center border-r border-border/60"
          >
            <Text variant="body-regular" numberOfLines={1}>
              {title}
            </Text>
          </Pressable>
          <View style={{ width: gridWidth, height: 36 }}>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={title}
              onPress={() => openRow(row.id)}
              style={{
                position: 'absolute',
                left: offsetDays * DAY_WIDTH + 2,
                top: 6,
                width: spanDays * DAY_WIDTH - 4,
                height: 24,
              }}
              className="bg-primary/20 border border-primary/50 rounded-md justify-center px-2"
            >
              <Text className="text-[11px] text-primary" numberOfLines={1}>
                {title}
              </Text>
            </Pressable>
          </View>
        </View>
      );
    });

  return (
    <View>
      <View className="flex-row items-center justify-end gap-1 px-3 py-2">
        <Button
          iconOnly
          appearance="plain"
          size="xs"
          accessibilityLabel={t('databases.timeline.earlier')}
          onPress={() => setWindowStart(addDays(windowStart, -STEP_DAYS))}
          leadingIcon={RiArrowLeftSLine}
        />
        <Button appearance="plain" size="xs" onPress={() => setWindowStart(defaultWindowStart())}>
          {t('databases.calendar.today')}
        </Button>
        <Button
          iconOnly
          appearance="plain"
          size="xs"
          accessibilityLabel={t('databases.timeline.later')}
          onPress={() => setWindowStart(addDays(windowStart, STEP_DAYS))}
          leadingIcon={RiArrowRightSLine}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
        <View>
          {/* date header */}
          <View
            className="flex-row border-b border-border bg-muted/30"
            style={{ height: 32, minWidth: gridWidth + titleWidth }}
          >
            <View
              style={{ width: titleWidth }}
              className="px-3 py-1 justify-center border-r border-border"
            >
              <Text className="text-xs font-semibold uppercase text-muted-foreground">
                {t('databases.timeline.row')}
              </Text>
            </View>
            {Array.from({ length: DAYS_WINDOW }, (_, i) => {
              const day = addDays(windowStart, i);
              const isFirstOfMonth = day.getDate() === 1 || i === 0;
              return (
                <View
                  key={day.getTime()}
                  style={{ width: DAY_WIDTH }}
                  className="items-center justify-center border-r border-border/60"
                >
                  <Text className="text-[10px] text-muted-foreground">
                    {isFirstOfMonth
                      ? day.toLocaleString(locale, { month: 'short' })
                      : day.getDate()}
                  </Text>
                </View>
              );
            })}
          </View>

          {bars.length === 0 ? (
            <View style={{ width: gridWidth + titleWidth }} className="px-3 py-6">
              <Text className="text-sm text-muted-foreground">
                {t('databases.timeline.noRows')}
              </Text>
            </View>
          ) : null}
          {lanes && grouping
            ? lanes.map((lane) => {
                const collapsed = viewGroups.isCollapsed(lane.key);
                const prefix = `${lane.key === null ? '\u0000' : lane.key}:`;
                return (
                  <View
                    key={`lane-${prefix}`}
                    testID={`timeline-lane-${lane.key ?? 'none'}`}
                    style={{ minWidth: gridWidth + titleWidth }}
                  >
                    {/* Its menu within the screen's width, in reach before scrolling. */}
                    <View
                      className="border-b border-border/60 bg-muted/20"
                      style={{ width: gridWidth + titleWidth }}
                    >
                      <View style={{ width: Math.min(width, gridWidth + titleWidth) }}>
                        <GroupHeader
                          property={grouping}
                          groupKey={lane.key}
                          granularity={view.groupBy?.granularity}
                          range={lane.range}
                          count={lane.count}
                          collapsed={collapsed}
                          onToggle={() => viewGroups.toggle(lane.key)}
                          actions={viewGroups.actionsFor(lane.key, laneKeys)}
                        />
                      </View>
                    </View>
                    {collapsed ? null : renderBars(barsOf(lane.rows), prefix)}
                  </View>
                );
              })
            : renderBars(bars, '')}
        </View>
      </ScrollView>
    </View>
  );
}

/** The first day shown by default: a week back from today. */
function defaultWindowStart(): Date {
  const today = new Date();
  return addDays(new Date(today.getFullYear(), today.getMonth(), today.getDate()), -7);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/**
 * The local days a row's bar covers: from its start to the end property's
 * day, else to its date's own end, else that one day. Null without a start.
 */
export function rowSpan(
  row: DatabaseRow,
  startPropertyId: string,
  endPropertyId: string | null,
): { start: Date; end: Date } | null {
  const date = readDateValue(row.properties[startPropertyId] ?? null);
  if (!date.start) return null;
  const start = dayOf(date.start, date.includeTime);
  const until = endPropertyId ? readDateValue(row.properties[endPropertyId] ?? null) : null;
  const endIso = until ? until.start : date.end;
  const end = endIso ? dayOf(endIso, until ? until.includeTime : date.includeTime) : start;
  return { start, end: end < start ? start : end };
}
