/**
 * What a database refuses to save in its views and properties: a filter, a
 * grouping, a calculation, a chart or a button that names a property which
 * cannot take it. Pure: each returns why (`Refusal`, sent as a 400) or null,
 * and the route sends it.
 */
import {
  acceptsCalculation,
  BOARD_GROUPABLE_PROPERTY_TYPES,
  isChartMeasurable,
  isGroupableType,
} from '@oxy.so/nilo-contracts';
import type { DatabaseProperty, DatabaseSchema, Filter } from '../../db/schema/databases.js';
import { invalidCondition } from './filters.js';
import { parsePropertyValue } from './property-values.js';

export interface Refusal {
  error: string;
  code:
    | 'INVALID_FILTER'
    | 'INVALID_GROUP'
    | 'INVALID_CALCULATION'
    | 'INVALID_CHART'
    | 'INVALID_BUTTON_ACTION';
  propertyId?: string;
  operator?: string;
}

/**
 * A filter must name the database's properties with operators their types
 * take: a view's, or the one a reader narrows a view's rows with.
 */
export function filterRefusal(schema: DatabaseSchema, filter: Filter | undefined): Refusal | null {
  if (!filter) return null;
  const invalid = invalidCondition(filter, new Map(schema.properties.map((p) => [p.id, p])));
  if (!invalid) return null;
  return {
    error: `"${invalid.operator}" cannot filter that property`,
    code: 'INVALID_FILTER',
    propertyId: invalid.propertyId,
    operator: invalid.operator,
  };
}

/**
 * What of a view `viewSettingsRefusal` reads, as a request's parsed body
 * gives it: zod, without `strict`, infers every field optional.
 */
export interface ViewSettings {
  type?: string;
  groupBy?: { propertyId?: string } | null;
  subGroupBy?: { propertyId?: string } | null;
  config?: {
    calculations?: Record<string, string>;
    chart?: {
      xAxis?: { propertyId?: string };
      yAxis?: { aggregate?: string; propertyId?: string };
    };
  };
}

/**
 * A view's grouping, calculations and chart must name properties of the
 * database that take them: a grouping a type with groups, a calculation one
 * its type offers (`CALCULATIONS_BY_TYPE`), a chart's sum or average a
 * number.
 */
export function viewSettingsRefusal(schema: DatabaseSchema, view: ViewSettings): Refusal | null {
  const byId = new Map(schema.properties.map((p) => [p.id, p]));
  const refusal = (error: string, code: Refusal['code'], propertyId?: string): Refusal => ({
    error,
    code,
    ...(propertyId !== undefined && { propertyId }),
  });
  for (const [index, grouping] of [view.groupBy, view.subGroupBy].entries()) {
    if (!grouping) continue;
    const property = byId.get(grouping.propertyId);
    const supported =
      property &&
      (view.type === 'board' && index === 0
        ? BOARD_GROUPABLE_PROPERTY_TYPES.some((type) => type === property.type)
        : isGroupableType(property.type));
    if (!supported) {
      return refusal('That property cannot group rows', 'INVALID_GROUP', grouping.propertyId);
    }
  }
  for (const [propertyId, fn] of Object.entries(view.config?.calculations ?? {})) {
    const property = byId.get(propertyId);
    if (!property || !acceptsCalculation(property.type, fn)) {
      return refusal(
        `"${fn}" cannot be calculated on that property`,
        'INVALID_CALCULATION',
        propertyId,
      );
    }
  }
  const chart = view.config?.chart;
  if (chart?.xAxis) {
    const property = byId.get(chart.xAxis.propertyId);
    if (!property || !isGroupableType(property.type)) {
      return refusal(
        'That property cannot be a chart axis',
        'INVALID_CHART',
        chart.xAxis.propertyId,
      );
    }
  }
  if (chart?.yAxis && chart.yAxis.aggregate !== 'count') {
    const property = chart.yAxis.propertyId ? byId.get(chart.yAxis.propertyId) : undefined;
    if (!property || !isChartMeasurable(property.type)) {
      return refusal('A chart adds up a number property', 'INVALID_CHART', chart.yAxis.propertyId);
    }
  }
  return null;
}

/**
 * A button's actions must set properties of this database that hold values
 * (not computed ones, nor another button), to a value their type stores.
 */
export function buttonActionsRefusal(
  schema: DatabaseSchema,
  property: DatabaseProperty,
): Refusal | null {
  if (property.type !== 'button') return null;
  for (const action of property.config?.actions ?? []) {
    if (action.kind !== 'set_property') continue;
    const target = schema.properties.find((p) => p.id === action.propertyId);
    let valid = false;
    if (target && target.id !== property.id) {
      try {
        valid = parsePropertyValue(target.type, action.value) !== null;
      } catch {
        valid = false;
      }
    }
    if (!valid) {
      return {
        error: 'A button can only set a property of its row to a value it holds',
        code: 'INVALID_BUTTON_ACTION',
        propertyId: action.propertyId,
      };
    }
  }
  return null;
}
