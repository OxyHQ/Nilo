import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { RiArrowLeftSLine } from '@oxy.so/bloom/icons/RiArrowLeftSLine';
import { RiArrowRightSLine } from '@oxy.so/bloom/icons/RiArrowRightSLine';
import { Button } from '@oxy.so/bloom/button';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import type { Database, DatabaseRow, DatabaseView } from '@/lib/types/databases';
import { useVisibleDatesStore } from '@/lib/stores/visible-dates-store';
import { visibleDatesFilter } from '@/lib/visible-dates';

interface ViewCalendarProps {
  database: Database;
  view: DatabaseView;
  rows: DatabaseRow[];
  isLoading: boolean;
}

/**
 * Calendar view — month grid keyed on a date property. Web-first;
 * native rendering shows a list-style fallback per the Phase 4 spec.
 */
export function ViewCalendar({ database, view, rows, isLoading }: ViewCalendarProps) {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const [cursor, setCursor] = React.useState(() => startOfMonth(new Date()));

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
    if (!datePropertyId || Platform.OS !== 'web') return;
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

  if (Platform.OS !== 'web') {
    // Native fallback — show rows grouped by month
    return (
      <EmptyState
        // icon: Calendar
        variant="compact"
        title={t('databases.calendar.webOnly')}
      />
    );
  }

  const days = buildMonthGrid(cursor);
  const rowsByDay = groupRowsByDay(rows, dateProperty.id);

  const monthLabel = cursor.toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  });

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
            onPress={() => setCursor(addMonths(cursor, -1))}
            leadingIcon={RiArrowLeftSLine}
          />
          <Button appearance="plain" size="xs" onPress={() => setCursor(startOfMonth(new Date()))}>
            {t('databases.calendar.today')}
          </Button>
          <Button
            iconOnly
            appearance="plain"
            size="xs"
            accessibilityLabel={t('databases.calendar.nextMonth')}
            onPress={() => setCursor(addMonths(cursor, 1))}
            leadingIcon={RiArrowRightSLine}
          />
        </View>
      </View>

      <View className="flex-row">
        {weekdayLabels(locale).map((label) => (
          <View key={label} className="flex-1 px-2 py-1 border-b border-border">
            <Text className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {label}
            </Text>
          </View>
        ))}
      </View>

      <View>
        {chunk(days, 7).map((week) => (
          <View
            key={week[0].toISOString()}
            className="flex-row border-b border-border/60"
            style={{ minHeight: 100 }}
          >
            {week.map((day) => {
              const inMonth = day.getMonth() === cursor.getMonth();
              const key = day.toISOString().slice(0, 10);
              const dayRows = rowsByDay.get(key) ?? [];
              return (
                <View
                  key={day.toISOString()}
                  className={`flex-1 border-r border-border/60 p-1.5 ${
                    inMonth ? '' : 'opacity-40'
                  }`}
                >
                  <Text className="mb-1 text-xs text-foreground">{day.getDate()}</Text>
                  <View className="gap-1">
                    {dayRows.slice(0, 3).map((row) => (
                      <Pressable
                        key={row.id}
                        onPress={() => router.push(`/p/${row.id}`)}
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
    </View>
  );
}

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

function groupRowsByDay(rows: DatabaseRow[], propertyId: string): Map<string, DatabaseRow[]> {
  const result = new Map<string, DatabaseRow[]>();
  for (const row of rows) {
    const value = row.properties[propertyId];
    if (!value || typeof value !== 'object' || !('start' in value)) continue;
    const start = value.start;
    if (typeof start !== 'string') continue;
    const d = new Date(start);
    if (Number.isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10);
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
