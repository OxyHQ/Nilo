import {
  STATUS_GROUP_IDS,
  type SelectOption,
  type StatusGroup,
  type StatusGroupId,
} from '@/lib/types/databases';

/**
 * A status property's groups as the API keeps them (`normalizeStatusGroups`):
 * the three, in their order; each option in one, the earliest that names it;
 * an option in none in "To-do"; within a group, options in the order the
 * property lists them.
 */
export function statusGroups(
  options: readonly SelectOption[],
  groups: readonly StatusGroup[] | undefined,
): StatusGroup[] {
  const placed = new Map<string, StatusGroupId>();
  for (const id of STATUS_GROUP_IDS)
    for (const group of groups ?? [])
      if (group.id === id)
        for (const optionId of group.optionIds) if (!placed.has(optionId)) placed.set(optionId, id);
  return STATUS_GROUP_IDS.map((id) => ({
    id,
    optionIds: options.filter((o) => (placed.get(o.id) ?? 'todo') === id).map((o) => o.id),
  }));
}
