import * as React from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { RiArrowLeftSLine } from '@oxy.so/bloom/icons/RiArrowLeftSLine';
import { RiArrowRightSLine } from '@oxy.so/bloom/icons/RiArrowRightSLine';
import { Button } from '@oxy.so/bloom/button';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import type { Database, DatabaseRow, DatabaseView } from '@/lib/types/databases';
import { dayKey, dayOf, fromDayKey, readDateValue } from '@/lib/date-values';
import { useVisibleDatesStore } from '@/lib/stores/visible-dates-store';
import { visibleDatesFilter } from '@/lib/visible-dates';
import { useOpenRow } from './open-row';

interface ViewCalendarProps {
  database: Database;
  view: DatabaseView;
  rows: DatabaseRow[];
  isLoading: boolean;
}

/** Narrower than this a day cell cannot hold titles: the grid marks days and lists the picked one. */
const COMPACT_WIDTH = 640;

/**
 * Calendar view — a month grid keyed on a date property, on web and native.
 * Wide, each day lists its rows; narrow (a phone), each day shows a mark per
 * row and the day picked lists them below the grid. Both read only the rows of
 * the six weeks shown (`useVisibleDatesStore`).
 */
export function ViewCalendar({ database, view, rows, isLoading }: ViewCalendarProps) {
  const openRow = useOpenRow();
  const { t, locale } = useTranslation();
  const { width } = useWindowDimensions();
  const compact = width < COMPACT_WIDTH;
  const [cursor, setCursor] = React.useState(() => startOfMonth(new Date()));
  const [picked, setPicked] = React.useState(() => dayKey(new Date()));

  const dateProperty = React.useMemo(() => {
    const id = view.config.datePropertyId;
    if (id) {
      const p = database.schema.properties.find((x) => x.id === id);
      if (p?.type === 'date') return p;
    }
    return database.schema.properties.find((p) => p.type === 'date') ?? null;
  }, [database.schema.properties, view.config.datePropertyId]);

  // The rows read are those of the six weeks the month's grid shows.
  const show = useVisibleDatesStore((state) => state.show);
  const datePropertyId = dateProperty?.id;
  React.useEffect(() => {
    if (!datePropertyId) return;
    const days = buildMonthGrid(cursor);
    show(
      view.id,
      visibleDatesFilter({
        startPropertyId: datePropertyId,
        from: days[0] as Date,
        to: days[days.length - 1] as Date,
      }),
    );
  }, [cursor, datePropertyId, show, view.id]);

  if (isLoading) {
    return (
      <View className="py-10 items-center">
        <Loading variant="spinner" />
      </View>
    );
  }

  if (!dateProperty) {
    return (
      <EmptyState
        // icon: Calendar
        variant="compact"
        title={t('databases.calendar.needsDateProperty')}
      />
    );
  }

  const days = buildMonthGrid(cursor);
  const rowsByDay = groupRowsByDay(rows, dateProperty.id);
  const monthLabel = cursor.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const goTo = (month: Date) => {
    setCursor(month);
    // A month moved to shows its first day's rows, or today's in this month.
    const today = new Date();
    setPicked(
      dayKey(
        today.getMonth() === month.getMonth() && today.getFullYear() === month.getFullYear()
          ? today
          : month,
      ),
    );
  };
  const pickedRows = rowsByDay.get(picked) ?? [];

  return (
    <View className="p-3">
      <View className="flex-row items-center justify-between mb-3">
        <Text variant="headline-semibold">{monthLabel}</Text>
        <View className="flex-row gap-1">
          <Button
            iconOnly
            appearance="plain"
            size="xs"
            accessibilityLabel={t('databases.calendar.previousMonth')}
            onPress={() => goTo(addMonths(cursor, -1))}
            leadingIcon={RiArrowLeftSLine}
          />
          <Button appearance="plain" size="xs" onPress={() => goTo(startOfMonth(new Date()))}>
            {t('databases.calendar.today')}
          </Button>
          <Button
            iconOnly
            appearance="plain"
            size="xs"
            accessibilityLabel={t('databases.calendar.nextMonth')}
            onPress={() => goTo(addMonths(cursor, 1))}
            leadingIcon={RiArrowRightSLine}
          />
        </View>
      </View>

      <View className="flex-row">
        {weekdayLabels(locale).map((label) => (
          <View key={label} className="flex-1 px-1 py-1 border-b border-border">
            <Text
              className={`text-[10px] uppercase tracking-wider text-muted-foreground ${
                compact ? 'text-center' : ''
              }`}
            >
              {label}
            </Text>
          </View>
        ))}
      </View>

      <View>
        {chunk(days, 7).map((week) => (
          <View
            key={dayKey(week[0] as Date)}
            className="flex-row border-b border-border/60"
            style={{ minHeight: compact ? 48 : 100 }}
          >
            {week.map((day) => {
              const key = dayKey(day);
              const dayRows = rowsByDay.get(key) ?? [];
              const inMonth = day.getMonth() === cursor.getMonth();
              return compact ? (
                <CompactDay
                  key={key}
                  day={day}
                  rowIds={dayRows.map((r) => r.id)}
                  inMonth={inMonth}
                  picked={key === picked}
                  label={day.toLocaleDateString(locale, { day: 'numeric', month: 'long' })}
                  onPress={() => setPicked(key)}
                />
              ) : (
                <View
                  key={key}
                  className={`flex-1 border-r border-border/60 p-1.5 ${inMonth ? '' : 'opacity-40'}`}
                >
                  <Text className="mb-1 text-xs text-foreground">{day.getDate()}</Text>
                  <View className="gap-1">
                    {dayRows.slice(0, 3).map((row) => (
                      <Pressable
                        key={row.id}
                        accessibilityRole="link"
                        accessibilityLabel={row.title || t('databases.untitled')}
                        onPress={() => openRow(row.id)}
                        className="bg-primary/10 rounded px-1.5 py-0.5"
                      >
                        <Text variant="caption-1-regular" numberOfLines={1}>
                          {row.title || t('databases.untitled')}
                        </Text>
                      </Pressable>
                    ))}
                    {dayRows.length > 3 ? (
                      <Text className="text-[10px] text-muted-foreground">
                        +{dayRows.length - 3}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        ))}
      </View>

      {compact ? (
        <View className="mt-3 gap-1" accessibilityLabel={t('databases.calendar.dayRows')}>
          <Text className="text-xs font-semibold uppercase text-muted-foreground">
            {fromDayKey(picked).toLocaleDateString(locale, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </Text>
          {pickedRows.length === 0 ? (
            <Text className="py-2 text-sm text-muted-foreground">
              {t('databases.calendar.noRows')}
            </Text>
          ) : (
            pickedRows.map((row) => (
              <Pressable
                key={row.id}
                accessibilityRole="link"
                accessibilityLabel={row.title || t('databases.untitled')}
                onPress={() => openRow(row.id)}
                className="rounded-md bg-primary/10 px-3 py-2"
              >
                <Text variant="body-regular" numberOfLines={1}>
                  {row.title || t('databases.untitled')}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

/** A day of the narrow grid: its number and a mark per row (three at most). */
function CompactDay({
  day,
  rowIds,
  inMonth,
  picked,
  label,
  onPress,
}: {
  day: Date;
  rowIds: string[];
  inMonth: boolean;
  picked: boolean;
  label: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const count = rowIds.length;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: picked }}
      accessibilityLabel={
        count > 0 ? `${label}, ${t('databases.calendar.rowCount', { count })}` : label
      }
      onPress={onPress}
      className={`flex-1 items-center gap-1 py-1.5 ${inMonth ? '' : 'opacity-40'}`}
    >
      <View
        className={`h-7 w-7 items-center justify-center rounded-full ${picked ? 'bg-primary' : ''}`}
      >
        <Text className={`text-xs ${picked ? 'text-primary-foreground' : 'text-foreground'}`}>
          {day.getDate()}
        </Text>
      </View>
      <View className="flex-row gap-0.5">
        {rowIds.slice(0, 3).map((id) => (
          <View key={id} className="h-1 w-1 rounded-full bg-primary" />
        ))}
      </View>
    </Pressable>
  );
}

/** `YYYY-MM-DD` of a local day: what a day cell and a row's date are matched on. */
/** Short weekday names, Sunday first, in the app's current locale. */
function weekdayLabels(locale: string): string[] {
  // 7 January 2024 was a Sunday.
  return Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 7 + i).toLocaleDateString(locale, { weekday: 'short' }),
  );
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function buildMonthGrid(monthStart: Date): Date[] {
  const start = new Date(monthStart);
  start.setDate(start.getDate() - start.getDay());
  const result: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    result.push(d);
  }
  return result;
}

/**
 * The rows by the day their date starts on, as the reader sees it: a date
 * without time on the day it names, one with a time on its local day.
 */
export function groupRowsByDay(
  rows: DatabaseRow[],
  propertyId: string,
): Map<string, DatabaseRow[]> {
  const result = new Map<string, DatabaseRow[]>();
  for (const row of rows) {
    const { start, includeTime } = readDateValue(row.properties[propertyId] ?? null);
    if (!start) continue;
    const key = dayKey(dayOf(start, includeTime));
    const bucket = result.get(key) ?? [];
    bucket.push(row);
    result.set(key, bucket);
  }
  return result;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
