/**
 * What a removed property leaves behind. Views name properties by id in their
 * sorts, filters, grouping, hidden and frozen lists and config, and a rollup
 * names its relation and the property it reads. Left alone, a removed id
 * keeps filtering and sorting on nothing, and a filter naming it can no longer
 * be saved (`invalidCondition`). The keys of the groups of its rows
 * (`groupOrder`, `collapsedGroups`, `hiddenGroups`, `numberGrouping`) name
 * that property's values: they go with it, when it changes type, and when the
 * view is grouped by another. Pure: the route writes what these return.
 */
import {
  acceptsCalculation,
  isChartMeasurable,
  isGroupableType,
  withoutGroupKeys,
} from '@oxy.so/nilo-contracts';
import type {
  DatabasePropertyType,
  DatabaseSchema,
  DatabaseViewType,
  Filter,
  FilterGroup,
  ViewChartConfig,
  ViewConfig,
  ViewGroupBy,
  ViewSort,
} from '../../db/schema/databases.js';
import { rowGrouping } from './groups.js';

/** The view fields a property can appear in. */
export interface PropertyReferencingView {
  /** Which grouping its group keys are of (`rowGrouping`); a table's when absent. */
  type?: DatabaseViewType;
  filters: FilterGroup;
  sorts: ViewSort[];
  groupBy: ViewGroupBy | null;
  subGroupBy?: ViewGroupBy | null;
  hiddenProperties: string[];
  frozenProperties: string[];
  config: ViewConfig;
}

/** The property a view's group keys are of. */
const sectionProperty = (view: Pick<PropertyReferencingView, 'type' | 'groupBy' | 'subGroupBy'>) =>
  rowGrouping({ ...view, type: view.type ?? 'table' })?.propertyId;

/**
 * The config a view is written with when `patch` changes it: as `patch`
 * gives it, but grouped by another property (or no longer grouped) with no
 * config given, without the old groups' keys. Undefined when the config
 * stays as it is.
 */
export function configAfterRegroup(
  view: Pick<PropertyReferencingView, 'type' | 'groupBy' | 'subGroupBy' | 'config'>,
  patch: {
    type?: DatabaseViewType;
    groupBy?: ViewGroupBy | null;
    subGroupBy?: ViewGroupBy | null;
    config?: ViewConfig;
  },
): ViewConfig | undefined {
  if (patch.config) return patch.config;
  const after = {
    type: patch.type ?? view.type,
    groupBy: patch.groupBy === undefined ? view.groupBy : patch.groupBy,
    subGroupBy: patch.subGroupBy === undefined ? view.subGroupBy : patch.subGroupBy,
  };
  if (sectionProperty(after) === sectionProperty(view)) return undefined;
  return withoutGroupKeys(view.config) ?? undefined;
}

const CONFIG_PROPERTY_KEYS = [
  'datePropertyId',
  'startPropertyId',
  'endPropertyId',
  'coverPropertyId',
] as const;

/**
 * `filter` without the conditions on `propertyId`, or null when nothing was
 * left of it. A group emptied that way goes too: an empty group passes every
 * row, which inside an `or` would let every row through.
 */
function pruneFilter(filter: Filter, propertyId: string): Filter | null {
  if (filter.kind === 'condition') return filter.propertyId === propertyId ? null : filter;
  const filters = filter.filters.flatMap((child) => pruneFilter(child, propertyId) ?? []);
  if (filters.length === 0 && filter.filters.length > 0) return null;
  return { ...filter, filters };
}

/** The view's filter without the conditions on `propertyId`; undefined when it had none. */
function prunedFilters(
  view: Pick<PropertyReferencingView, 'filters'>,
  propertyId: string,
): FilterGroup | undefined {
  const filters = pruneFilter(view.filters, propertyId) as FilterGroup | null;
  if (JSON.stringify(filters) === JSON.stringify(view.filters)) return undefined;
  // The top-level group stays, emptied: it is the view's filter.
  return filters ?? { ...view.filters, filters: [] };
}

/** `chart` without an axis on `propertyId`, but for those `keep` says still apply. */
function chartWithout(
  chart: ViewChartConfig,
  propertyId: string,
  keep: { x: boolean; y: boolean },
): ViewChartConfig {
  let next = chart;
  if (!keep.x && next.xAxis?.propertyId === propertyId) {
    const { xAxis: _x, ...rest } = next;
    next = rest;
  }
  // Nothing left to add up: the chart counts its rows.
  if (!keep.y && next.yAxis?.propertyId === propertyId) {
    next = { ...next, yAxis: { aggregate: 'count' } };
  }
  return next;
}

/**
 * The fields of `view` that change once `propertyId` is gone, or null when it
 * named the property nowhere.
 */
export function viewWithoutProperty(
  view: PropertyReferencingView,
  propertyId: string,
): Partial<PropertyReferencingView> | null {
  const patch: Partial<PropertyReferencingView> = {};
  const filters = prunedFilters(view, propertyId);
  if (filters) patch.filters = filters;
  if (view.sorts.some((s) => s.propertyId === propertyId)) {
    patch.sorts = view.sorts.filter((s) => s.propertyId !== propertyId);
  }
  if (view.groupBy?.propertyId === propertyId) patch.groupBy = null;
  if (view.hiddenProperties.includes(propertyId)) {
    patch.hiddenProperties = view.hiddenProperties.filter((id) => id !== propertyId);
  }
  if (view.frozenProperties.includes(propertyId)) {
    patch.frozenProperties = view.frozenProperties.filter((id) => id !== propertyId);
  }
  if (view.subGroupBy?.propertyId === propertyId) patch.subGroupBy = null;
  let config = configWithout(view.config, propertyId);
  if (sectionProperty(view) === propertyId)
    config = withoutGroupKeys(config ?? view.config) ?? config;
  if (config) patch.config = config;
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * A view's config without `propertyId`: its dates and cover, its column width
 * and place in the view's order, its calculation, a chart axis on it. Null
 * when the config never named it.
 */
function configWithout(view: ViewConfig, propertyId: string): ViewConfig | null {
  const config: ViewConfig = { ...view };
  for (const key of CONFIG_PROPERTY_KEYS) if (config[key] === propertyId) delete config[key];
  if (config.columnWidths && propertyId in config.columnWidths) {
    const { [propertyId]: _width, ...widths } = config.columnWidths;
    config.columnWidths = widths;
  }
  if (config.propertyOrder?.includes(propertyId)) {
    config.propertyOrder = config.propertyOrder.filter((id) => id !== propertyId);
  }
  if (config.calculations && propertyId in config.calculations) {
    const { [propertyId]: _fn, ...calculations } = config.calculations;
    config.calculations = calculations;
  }
  if (config.chart) config.chart = chartWithout(config.chart, propertyId, { x: false, y: false });
  return JSON.stringify(config) === JSON.stringify(view) ? null : config;
}

/**
 * What of `view` changes once `propertyId` became a `type`, or null when
 * nothing does: its conditions go, as their operators and values were the
 * old type's (a select's option ids mean nothing to a text), and so do a
 * grouping, a calculation or a chart axis the new type does not take, and
 * the keys of the groups it grouped the rows in. Its sorts and the rest still
 * apply to the new type and stay.
 */
export function viewAfterRetype(
  view: PropertyReferencingView,
  propertyId: string,
  type?: DatabasePropertyType,
): Partial<Pick<PropertyReferencingView, 'filters' | 'groupBy' | 'subGroupBy' | 'config'>> | null {
  const patch: Partial<
    Pick<PropertyReferencingView, 'filters' | 'groupBy' | 'subGroupBy' | 'config'>
  > = {};
  const filters = prunedFilters(view, propertyId);
  if (filters) patch.filters = filters;
  if (type && !isGroupableType(type)) {
    if (view.groupBy?.propertyId === propertyId) patch.groupBy = null;
    if (view.subGroupBy?.propertyId === propertyId) patch.subGroupBy = null;
  }
  if (type) {
    const config: ViewConfig = { ...view.config };
    const fn = config.calculations?.[propertyId];
    if (config.calculations && fn && !acceptsCalculation(type, fn)) {
      const { [propertyId]: _fn, ...calculations } = config.calculations;
      config.calculations = calculations;
    }
    if (config.chart) {
      config.chart = chartWithout(config.chart, propertyId, {
        x: isGroupableType(type),
        y: isChartMeasurable(type),
      });
    }
    const regrouped = sectionProperty(view) === propertyId ? withoutGroupKeys(config) : null;
    const next = regrouped ?? config;
    if (JSON.stringify(next) !== JSON.stringify(view.config)) patch.config = next;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * The schema of database `databaseId` without `propertyId`, its rollups that
 * read it unset: one whose relation it was loses its relation and target
 * property, one that read it through a relation to this same database loses
 * its target property. A rollup reading another database is left alone, even
 * when that database has a property of the same id (`status` is every default
 * schema's).
 */
export function schemaWithoutProperty(
  schema: DatabaseSchema,
  databaseId: string,
  propertyId: string,
): DatabaseSchema {
  const targetOf = (relationId: string | undefined) =>
    schema.properties.find((p) => p.id === relationId && p.type === 'relation')?.config
      ?.targetDatabaseId;
  return {
    properties: schema.properties.flatMap((property) => {
      if (property.id === propertyId) return [];
      const config = property.config;
      // A button stops setting a property that is gone.
      if (property.type === 'button' && config?.actions) {
        const actions = config.actions.filter(
          (a) => a.kind !== 'set_property' || a.propertyId !== propertyId,
        );
        return [
          actions.length === config.actions.length
            ? property
            : { ...property, config: { ...config, actions } },
        ];
      }
      if (property.type !== 'rollup' || !config) return [property];
      if (config.relationPropertyId === propertyId) {
        const { relationPropertyId: _relation, targetPropertyId: _target, ...rest } = config;
        return [{ ...property, config: rest }];
      }
      if (
        config.targetPropertyId === propertyId &&
        targetOf(config.relationPropertyId) === databaseId
      ) {
        const { targetPropertyId: _target, ...rest } = config;
        return [{ ...property, config: rest }];
      }
      return [property];
    }),
  };
}
