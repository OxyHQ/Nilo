import * as React from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import {
  barLayout,
  CHART_SERIES,
  donutArcs,
  foldSlices,
  linePath,
  linePoints,
  niceTicks,
  type PlotBox,
  seriesColor,
} from '@/lib/chart-geometry';
import { useViewChart } from '@/lib/hooks/use-view-data';
import { formatNumberValue } from '@/lib/number-format';
import { useColorScheme } from '@/lib/useColorScheme';
import type { Database, DatabaseProperty, DatabaseView } from '@/lib/types/databases';
import { useGroupLabel } from './group-label';

interface ViewChartProps {
  database: Database;
  view: DatabaseView;
}

const PLOT_HEIGHT = 240;
const AXIS_WIDTH = 44;
const LABEL_HEIGHT = 28;
/** A donut shows at most this many slices, the rest folded into one. */
const MAX_SLICES = 8;

interface Point {
  key: string | null;
  label: string;
  value: number | null;
}

/**
 * A chart view: the rows grouped by its x-axis property (`config.chart`), one
 * bar, line point or donut slice per group, measuring how many rows it holds
 * or the sum or average of a number — computed by the API over every row the
 * view shows. Drawn natively (react-native-svg) on every platform; hovering
 * or pressing a mark reads out its group and value, and every value is listed
 * under the chart as well.
 */
export function ViewChart({ database, view }: ViewChartProps) {
  const { t, locale } = useTranslation();
  const chart = view.config.chart ?? { type: 'bar' as const };
  const xProperty = database.schema.properties.find((p) => p.id === chart.xAxis?.propertyId);
  const data = useViewChart(database.id, view.id, Boolean(xProperty));
  const label = useGroupLabel(
    xProperty ?? (database.schema.properties[0] as DatabaseProperty),
    chart.xAxis?.granularity,
  );
  const measured =
    chart.yAxis && chart.yAxis.aggregate !== 'count'
      ? database.schema.properties.find((p) => p.id === chart.yAxis?.propertyId)
      : undefined;
  const format = React.useCallback(
    (value: number | null) => {
      if (value === null) return '—';
      if (measured?.type === 'number') {
        const precise = measured.config?.precision === undefined && !Number.isInteger(value);
        return formatNumberValue(
          value,
          precise ? { ...measured.config, precision: 2 } : measured.config,
          locale,
        );
      }
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
    },
    [measured, locale],
  );

  if (!xProperty) {
    return <EmptyState variant="compact" title={t('databases.chart.needsAxis')} />;
  }
  if (data.isLoading) {
    return (
      <View className="items-center py-10">
        <Loading variant="spinner" accessibilityLabel={t('common.loading')} />
      </View>
    );
  }
  if (data.isError || !data.data) {
    return (
      <EmptyState
        variant="compact"
        title={t('databases.chart.loadFailed')}
        action={{ label: t('databases.chart.retry'), onPress: () => void data.refetch() }}
      />
    );
  }
  const hideEmpty = chart.type === 'donut';
  const points: Point[] = data.data.points
    .filter((p) => !hideEmpty || (p.value ?? 0) > 0)
    .map((p) => ({ key: p.key, label: label(p.key, p.range), value: p.value }));
  if (points.every((p) => !p.value)) {
    return <EmptyState variant="compact" title={t('databases.chart.empty')} />;
  }
  const typeLabel = t(`databases.viewSettings.chartTypes.${chart.type}`);
  const summary = t('databases.chart.summary', {
    type: typeLabel,
    name: xProperty.name,
    points: points.map((p) => `${p.label} ${format(p.value)}`).join(', '),
  });

  return (
    <View className="gap-3 px-4 py-3" testID="view-chart">
      {chart.type === 'donut' ? (
        <DonutChart points={points} format={format} summary={summary} />
      ) : (
        <CartesianChart type={chart.type} points={points} format={format} summary={summary} />
      )}
    </View>
  );
}

interface ChartProps {
  points: Point[];
  format: (value: number | null) => string;
  /** What the chart shows, for assistive tech. */
  summary: string;
}

/** The hovered or pressed mark's group and value, above the chart; the chart's name at rest. */
function Readout({ point, format }: { point: Point | null; format: ChartProps['format'] }) {
  return (
    <View className="min-h-6 flex-row items-baseline gap-2">
      {point ? (
        <>
          <Text className="text-sm text-muted-foreground" numberOfLines={1}>
            {point.label}
          </Text>
          <Text className="text-base font-semibold text-foreground">{format(point.value)}</Text>
        </>
      ) : null}
    </View>
  );
}

/** Bars from the baseline, or a line through the points, with a y axis of round ticks. */
function CartesianChart({ type, points, format, summary }: ChartProps & { type: 'bar' | 'line' }) {
  const { colors, isDarkColorScheme } = useColorScheme();
  const [width, setWidth] = React.useState(0);
  const [active, setActive] = React.useState<number | null>(null);
  const values = points.map((p) => p.value ?? 0);
  const ticks = niceTicks(Math.max(...values, 0));
  const top = ticks.at(-1) ?? 1;
  const box: PlotBox = {
    left: AXIS_WIDTH,
    top: 8,
    width: Math.max(0, width - AXIS_WIDTH),
    height: PLOT_HEIGHT - 8,
  };
  const color = seriesColor(isDarkColorScheme);
  const slot = points.length > 0 ? box.width / points.length : 0;
  // As many x labels as fit, every n-th, so none collide.
  const every = Math.max(1, Math.ceil(72 / Math.max(1, slot)));
  const bars = barLayout(values, box, top);
  const line = linePoints(
    points.map((p) => p.value),
    box,
    top,
  );

  return (
    <View>
      <Readout point={active === null ? null : (points[active] ?? null)} format={format} />
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{ height: PLOT_HEIGHT + LABEL_HEIGHT }}
        accessible
        accessibilityRole="image"
        accessibilityLabel={summary}
      >
        {width > 0 ? (
          <Svg width={width} height={PLOT_HEIGHT + LABEL_HEIGHT} pointerEvents="none">
            {ticks.map((tick) => {
              const y = box.top + box.height - (tick / top) * box.height;
              return (
                <G key={tick}>
                  <Line
                    x1={box.left}
                    x2={box.left + box.width}
                    y1={y}
                    y2={y}
                    stroke={colors.border}
                    strokeWidth={1}
                  />
                  <SvgText
                    x={box.left - 6}
                    y={y + 4}
                    fontSize={11}
                    fill={colors.mutedForeground}
                    textAnchor="end"
                  >
                    {format(tick)}
                  </SvgText>
                </G>
              );
            })}
            {type === 'bar'
              ? bars.map((bar, i) => (
                  <Path
                    key={points[i]?.key ?? `none-${i}`}
                    d={roundedTop(bar.x, bar.y, bar.width, bar.height)}
                    fill={color}
                    opacity={active === null || active === i ? 1 : 0.5}
                  />
                ))
              : null}
            {type === 'line' ? (
              <>
                <Path d={linePath(line)} stroke={color} strokeWidth={2} fill="none" />
                {line.map((point, i) =>
                  point ? (
                    <Circle
                      key={points[i]?.key ?? `none-${i}`}
                      cx={point.x}
                      cy={point.y}
                      r={active === i ? 5 : 4}
                      fill={color}
                      stroke={colors.background}
                      strokeWidth={2}
                    />
                  ) : null,
                )}
              </>
            ) : null}
            {points.map((point, i) =>
              i % every === 0 ? (
                <SvgText
                  key={point.key ?? `none-${i}`}
                  x={box.left + i * slot + slot / 2}
                  y={PLOT_HEIGHT + 18}
                  fontSize={11}
                  fill={colors.mutedForeground}
                  textAnchor="middle"
                >
                  {truncate(point.label, Math.max(4, Math.floor((slot * every) / 7)))}
                </SvgText>
              ) : null,
            )}
          </Svg>
        ) : null}
        {/* Hit targets, a whole slot tall each: hovered on the web, pressed anywhere. */}
        <View
          className="absolute flex-row"
          style={{ left: box.left, top: 0, width: box.width, height: PLOT_HEIGHT }}
        >
          {points.map((point, i) => (
            <Pressable
              key={point.key ?? `none-${i}`}
              accessibilityRole="button"
              accessibilityLabel={`${point.label}, ${format(point.value)}`}
              onHoverIn={() => setActive(i)}
              onHoverOut={() => setActive((current) => (current === i ? null : current))}
              onPress={() => setActive((current) => (current === i ? null : i))}
              style={{ flex: 1 }}
            />
          ))}
        </View>
      </View>
      <ValueList points={points} format={format} active={active} onActive={setActive} />
    </View>
  );
}

/** A donut of the groups' shares, the total in its middle, a legend with every value. */
function DonutChart({ points, format, summary }: ChartProps) {
  const { t } = useTranslation();
  const { colors, isDarkColorScheme } = useColorScheme();
  const [active, setActive] = React.useState<number | null>(null);
  const slices = foldSlices(
    points.map((p) => ({ label: p.label, value: p.value ?? 0 })),
    MAX_SLICES,
    t('databases.chart.other'),
  );
  const palette = isDarkColorScheme ? CHART_SERIES.dark : CHART_SERIES.light;
  const size = 220;
  const arcs = donutArcs(
    slices.map((s) => s.value),
    size / 2,
    size / 2,
    size / 2 - 4,
    size / 2 - 40,
  );
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const shown = active === null ? null : slices[active];
  const legend: Point[] = slices.map((s, i) => ({
    key: String(i),
    label: s.label,
    value: s.value,
  }));

  return (
    <View className="items-center gap-3">
      <View
        style={{ width: size, height: size }}
        accessible
        accessibilityRole="image"
        accessibilityLabel={summary}
      >
        <Svg width={size} height={size}>
          {arcs.map((d, i) =>
            d ? (
              <Path
                // biome-ignore lint/suspicious/noArrayIndexKey: a slice is its place among the groups
                key={i}
                d={d}
                fill={palette[i] ?? palette[0]}
                stroke={colors.background}
                strokeWidth={2}
                opacity={active === null || active === i ? 1 : 0.5}
                onPress={() => setActive((current) => (current === i ? null : i))}
              />
            ) : null,
          )}
        </Svg>
        <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {shown ? shown.label : t('databases.chart.total')}
          </Text>
          <Text className="text-xl font-semibold text-foreground">
            {format(shown ? shown.value : total)}
          </Text>
        </View>
      </View>
      <ValueList
        points={legend}
        format={format}
        active={active}
        onActive={setActive}
        swatches={palette}
        total={total}
      />
    </View>
  );
}

/**
 * Every group and its value, under the chart: the chart's legend (a swatch
 * per slice) and its table, so no value is read from colour or height alone.
 */
function ValueList({
  points,
  format,
  active,
  onActive,
  swatches,
  total,
}: {
  points: Point[];
  format: ChartProps['format'];
  active: number | null;
  onActive: (index: number | null) => void;
  swatches?: readonly string[];
  total?: number;
}) {
  const { locale } = useTranslation();
  return (
    <View className="flex-row flex-wrap gap-x-4 gap-y-1">
      {points.map((point, i) => (
        <Pressable
          key={point.key ?? `none-${i}`}
          onHoverIn={() => onActive(i)}
          onHoverOut={() => onActive(null)}
          onPress={() => onActive(active === i ? null : i)}
          className="flex-row items-center gap-1.5"
          accessibilityRole="button"
          accessibilityLabel={`${point.label}, ${format(point.value)}`}
        >
          {swatches ? (
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                backgroundColor: swatches[i] ?? swatches[0],
              }}
            />
          ) : null}
          <Text
            className={`text-xs ${active === i ? 'text-foreground' : 'text-muted-foreground'}`}
            numberOfLines={1}
          >
            {point.label}
          </Text>
          <Text className="text-xs font-medium text-foreground">{format(point.value)}</Text>
          {total && point.value !== null ? (
            <Text className="text-xs text-muted-foreground">
              {new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
                point.value / total,
              )}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

/** A bar whose top corners are rounded (4, or less for a narrow or short bar), square at the baseline. */
function roundedTop(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

function truncate(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, Math.max(1, max - 1))}…` : label;
}
