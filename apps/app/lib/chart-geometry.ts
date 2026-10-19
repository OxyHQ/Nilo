/**
 * A chart view's geometry, apart from drawing it: the y axis's ticks, the
 * bars and line points in a plot box, the donut's arcs, and which colours
 * its slices take. Pure, so it is tested without a renderer.
 */

/** Categorical hues, in a fixed order validated for colour-blind separation (light, dark). */
export const CHART_SERIES = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
} as const;

/** A single series' hue (bars, a line): the first slot. */
export function seriesColor(dark: boolean): string {
  return dark ? CHART_SERIES.dark[0] : CHART_SERIES.light[0];
}

export interface ChartDatum {
  label: string;
  value: number;
}

/**
 * At most `max` slices, in order: past that, the rest fold into one slice
 * labelled `other`, so no hue is ever generated or reused.
 */
export function foldSlices(data: readonly ChartDatum[], max: number, other: string): ChartDatum[] {
  if (data.length <= max) return [...data];
  const kept = data.slice(0, max - 1);
  const rest = data.slice(max - 1).reduce((sum, d) => sum + d.value, 0);
  return [...kept, { label: other, value: rest }];
}

/** Round tick steps (1, 2, 5 × 10ⁿ) from 0 to at least `max`, about `count` of them. */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const raw = max / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? power * 10;
  const ticks: number[] = [];
  for (let v = 0; v < max + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  if ((ticks.at(-1) ?? 0) < max) ticks.push(Number((ticks.length * step).toPrecision(12)));
  return ticks;
}

export interface PlotBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Bar {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Each value's bar, from the baseline up, `gap` apart, scaled to `top` (the highest tick). */
export function barLayout(values: readonly number[], box: PlotBox, top: number, gap = 2): Bar[] {
  if (values.length === 0) return [];
  const slot = box.width / values.length;
  const width = Math.max(2, Math.min(48, slot * 0.7) - gap);
  return values.map((value, i) => {
    const height = top > 0 ? (Math.max(0, value) / top) * box.height : 0;
    return {
      x: box.left + i * slot + (slot - width) / 2,
      y: box.top + box.height - height,
      width,
      height,
    };
  });
}

/** The line's points: one per value at the middle of its slot. */
export function linePoints(
  values: readonly (number | null)[],
  box: PlotBox,
  top: number,
): ({ x: number; y: number } | null)[] {
  const slot = values.length > 0 ? box.width / values.length : 0;
  return values.map((value, i) =>
    value === null
      ? null
      : {
          x: box.left + i * slot + slot / 2,
          y: box.top + box.height - (top > 0 ? (Math.max(0, value) / top) * box.height : 0),
        },
  );
}

/** An SVG path through `points`, a gap where a point is missing. */
export function linePath(points: readonly ({ x: number; y: number } | null)[]): string {
  let path = '';
  let drawing = false;
  for (const point of points) {
    if (!point) {
      drawing = false;
      continue;
    }
    path += `${drawing ? 'L' : 'M'}${round(point.x)},${round(point.y)}`;
    drawing = true;
  }
  return path;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * A donut's slices as SVG arc paths around (`cx`, `cy`), clockwise from the
 * top, `gapDegrees` apart; a slice of nothing is no path. One slice that is
 * everything is a full ring (two half arcs).
 */
export function donutArcs(
  values: readonly number[],
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  gapDegrees = 1.5,
): (string | null)[] {
  const total = values.reduce((sum, v) => sum + Math.max(0, v), 0);
  if (total <= 0) return values.map(() => null);
  const shown = values.filter((v) => v > 0).length;
  const gap = shown > 1 ? gapDegrees : 0;
  let angle = 0;
  return values.map((value) => {
    if (value <= 0) return null;
    const sweep = (value / total) * 360;
    const start = angle + gap / 2;
    const end = angle + sweep - gap / 2;
    angle += sweep;
    if (sweep >= 359.999) {
      return `${arc(cx, cy, outer, inner, 0, 180)} ${arc(cx, cy, outer, inner, 180, 360)}`;
    }
    return arc(cx, cy, outer, inner, start, Math.max(start + 0.1, end));
  });
}

function polar(cx: number, cy: number, r: number, degrees: number) {
  const rad = ((degrees - 90) * Math.PI) / 180;
  return { x: round(cx + r * Math.cos(rad)), y: round(cy + r * Math.sin(rad)) };
}

function arc(cx: number, cy: number, outer: number, inner: number, from: number, to: number) {
  const large = to - from > 180 ? 1 : 0;
  const a = polar(cx, cy, outer, from);
  const b = polar(cx, cy, outer, to);
  const c = polar(cx, cy, inner, to);
  const d = polar(cx, cy, inner, from);
  return `M${a.x},${a.y} A${outer},${outer} 0 ${large} 1 ${b.x},${b.y} L${c.x},${c.y} A${inner},${inner} 0 ${large} 0 ${d.x},${d.y} Z`;
}
