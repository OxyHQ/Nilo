/**
 * What a removed property leaves behind. Views name properties by id in their
 * sorts, filters, grouping, hidden and frozen lists and config, and a rollup
 * names its relation and the property it reads. Left alone, a removed id
 * keeps filtering and sorting on nothing, and a filter naming it can no longer
 * be saved (`invalidCondition`). Pure: the route writes what these return.
 */
import type {
  DatabaseSchema,
  Filter,
  FilterGroup,
  ViewConfig,
  ViewGroupBy,
  ViewSort,
} from '../../db/schema/databases.js';

/** The view fields a property can appear in. */
export interface PropertyReferencingView {
  filters: FilterGroup;
  sorts: ViewSort[];
  groupBy: ViewGroupBy | null;
  hiddenProperties: string[];
  frozenProperties: string[];
  config: ViewConfig;
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

/**
 * The fields of `view` that change once `propertyId` is gone, or null when it
 * named the property nowhere.
 */
export function viewWithoutProperty(
  view: PropertyReferencingView,
  propertyId: string,
): Partial<PropertyReferencingView> | null {
  const patch: Partial<PropertyReferencingView> = {};
  const filters = pruneFilter(view.filters, propertyId) as FilterGroup | null;
  if (JSON.stringify(filters) !== JSON.stringify(view.filters)) {
    // The top-level group stays, emptied: it is the view's filter.
    patch.filters = filters ?? { ...view.filters, filters: [] };
  }
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
  if (CONFIG_PROPERTY_KEYS.some((key) => view.config[key] === propertyId)) {
    const config: ViewConfig = { ...view.config };
    for (const key of CONFIG_PROPERTY_KEYS) if (config[key] === propertyId) delete config[key];
    patch.config = config;
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
