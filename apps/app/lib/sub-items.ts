import type { Database, DatabaseRow, PropertyValue } from './types/databases';

export function relationIds(value: PropertyValue | undefined): string[] {
  return value && 'pageIds' in value ? value.pageIds : [];
}

/** The server appends the reciprocal after the source; names remain editable. */
export function subItemProperties(database: Database) {
  const properties = database.schema.properties;
  for (const property of properties) {
    if (
      property.type !== 'relation' ||
      !property.config?.twoWay ||
      property.config.targetDatabaseId !== database.id
    )
      continue;
    const parent = properties.find(
      (p) =>
        p.id === property.config?.syncedPropertyId && p.config?.syncedPropertyId === property.id,
    );
    if (parent) return { children: property, parent };
  }
  return null;
}

export type NestedRow =
  | { kind: 'row'; row: DatabaseRow; depth: number }
  | { kind: 'new'; parentId: string; depth: number };

/** Preserve view ordering, keep filtered-out parents' children at root, and break cycles. */
export function nestSubItems(
  rows: DatabaseRow[],
  parentPropertyId: string | undefined,
  expanded: ReadonlySet<string>,
): NestedRow[] {
  if (!parentPropertyId) return rows.map((row) => ({ kind: 'row', row, depth: 0 }));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const parents = new Map<string, string>();
  for (const row of rows) {
    const parent = relationIds(row.properties[parentPropertyId]).find(
      (id) => id !== row.id && byId.has(id),
    );
    if (!parent) continue;
    let ancestor: string | undefined = parent;
    const visited = new Set([row.id]);
    while (ancestor && !visited.has(ancestor)) {
      visited.add(ancestor);
      ancestor = parents.get(ancestor);
    }
    if (!ancestor) parents.set(row.id, parent);
  }
  const children = new Map<string, DatabaseRow[]>();
  for (const row of rows) {
    const parent = parents.get(row.id);
    if (parent) children.set(parent, [...(children.get(parent) ?? []), row]);
  }
  const result: NestedRow[] = [];
  const visit = (row: DatabaseRow, depth: number) => {
    result.push({ kind: 'row', row, depth });
    if (!expanded.has(row.id)) return;
    for (const child of children.get(row.id) ?? []) visit(child, depth + 1);
    result.push({ kind: 'new', parentId: row.id, depth: depth + 1 });
  };
  for (const row of rows) if (!parents.has(row.id)) visit(row, 0);
  return result;
}
