import { randomUUID } from 'node:crypto';
import {
  STATUS_GROUP_IDS,
  type DatabaseProperty,
  type DatabaseSchema,
  type PropertyConfig,
  type SelectOption,
  type StatusGroup,
} from '../../db/schema/databases.js';

/**
 * Build the default property schema used when a Database is created without
 * an explicit one. Mirrors Notion's first-run defaults — a `Name` text
 * property and a `Status` select property.
 *
 * The "Name" property is special: its value is mirrored to the row's
 * `title` field so that:
 *   - the row's page header shows the same string,
 *   - default views surface a recognizable label,
 *   - links to a row render with a useful preview.
 */
export const NAME_PROPERTY_ID = 'name';
export const NAME_PROPERTY_NAME = 'Name';

export function buildDefaultSchema(): DatabaseSchema {
  const properties: DatabaseProperty[] = [
    {
      id: NAME_PROPERTY_ID,
      name: NAME_PROPERTY_NAME,
      type: 'text',
    },
    { id: 'status', name: 'Status', type: 'status', config: defaultStatusConfig() },
  ];

  return { properties };
}

/**
 * A new status property's options, one in each of its groups, as Notion's:
 * "Not started" to do, "In progress", "Done" complete.
 */
export function defaultStatusConfig(): PropertyConfig {
  const todo = randomUUID();
  const inProgress = randomUUID();
  const done = randomUUID();
  return {
    options: [
      { id: todo, name: 'Not started', color: 'gray' },
      { id: inProgress, name: 'In progress', color: 'blue' },
      { id: done, name: 'Done', color: 'green' },
    ],
    groups: [
      { id: 'todo', optionIds: [todo] },
      { id: 'in_progress', optionIds: [inProgress] },
      { id: 'complete', optionIds: [done] },
    ],
  };
}

/**
 * A status property's groups made whole: always the three, in their order;
 * an option in one group only (the earliest of those that name it); an id naming no
 * option dropped; an option in none put in "To-do", as Notion files one.
 * Status properties written before groups existed get them this way the next
 * time they are written; until then the app shows their options ungrouped.
 */
export function normalizeStatusGroups(
  options: readonly SelectOption[],
  groups: readonly StatusGroup[] | undefined,
): StatusGroup[] {
  const known = new Set(options.map((o) => o.id));
  const placed = new Set<string>();
  const out = STATUS_GROUP_IDS.map((id) => {
    const optionIds: string[] = [];
    for (const group of groups ?? []) {
      if (group.id !== id) continue;
      for (const optionId of group.optionIds) {
        if (!known.has(optionId) || placed.has(optionId)) continue;
        placed.add(optionId);
        optionIds.push(optionId);
      }
    }
    return { id, optionIds };
  });
  for (const option of options) if (!placed.has(option.id)) out[0].optionIds.push(option.id);
  return out;
}

/**
 * The Name property's id is fixed — `"name"` — so the title <-> Name sync
 * doesn't depend on schema metadata. UI may still rename it; only the
 * `id` is load-bearing.
 */
export function findNameProperty(schema: DatabaseSchema): DatabaseProperty | null {
  return schema.properties.find((p) => p.id === NAME_PROPERTY_ID) ?? null;
}
