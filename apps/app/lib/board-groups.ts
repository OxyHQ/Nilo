import { BOARD_GROUPABLE_PROPERTY_TYPES } from '@oxy.so/nilo-contracts';
import { statusGroups } from './status-groups';
import type { DatabaseProperty, DatabaseRow, PropertyValue, SelectOption } from './types/databases';

export interface BoardColumnData {
  option: SelectOption;
  rows: DatabaseRow[];
  value: PropertyValue;
}

export interface BoardSection {
  id: string;
  label: string | null;
  columns: BoardColumnData[];
}

export function canGroupBoard(property: DatabaseProperty): boolean {
  return BOARD_GROUPABLE_PROPERTY_TYPES.some((type) => type === property.type);
}

export function boardValueKeys(value: PropertyValue): string[] {
  if (!value || typeof value !== 'object') return [];
  if ('optionId' in value) return value.optionId ? [value.optionId] : [];
  if ('optionIds' in value) return value.optionIds;
  if ('userIds' in value) return value.userIds;
  if ('pageIds' in value) return value.pageIds;
  return [];
}

function assignment(property: DatabaseProperty, ids: string[]): PropertyValue {
  if (property.type === 'multi_select') return { optionIds: ids };
  if (property.type === 'person') return { userIds: ids };
  if (property.type === 'relation') return { pageIds: ids };
  return { optionId: ids[0] ?? null };
}

/** Moving one occurrence preserves the page's other labels, people or relations. */
export function boardMoveValue(
  property: DatabaseProperty,
  current: PropertyValue,
  from: PropertyValue,
  to: PropertyValue,
): PropertyValue {
  if (!['multi_select', 'person', 'relation'].includes(property.type)) return to;
  const target = boardValueKeys(to);
  if (target.length === 0) return assignment(property, []);
  const source = new Set(boardValueKeys(from));
  return assignment(property, [
    ...new Set([...boardValueKeys(current).filter((id) => !source.has(id)), ...target]),
  ]);
}

/** One row per column occurrence; groups may duplicate a row in the API response. */
export function boardSections(
  property: DatabaseProperty,
  input: readonly DatabaseRow[],
  text: {
    checked: string;
    unchecked: string;
    unassigned: string;
    statusGroup: (id: string) => string;
    reference: (id: string) => string;
    /** All loaded references, so sub-group lanes keep the same columns. */
    referenceIds?: readonly string[];
  },
): BoardSection[] {
  const rows = [...new Map(input.map((row) => [row.id, row])).values()];
  if (property.type === 'checkbox') {
    const checked = (row: DatabaseRow) => {
      const value = row.properties[property.id];
      return Boolean(value && typeof value === 'object' && 'checked' in value && value.checked);
    };
    return [
      {
        id: 'checkbox',
        label: null,
        columns: [
          {
            option: { id: 'checked', name: text.checked, color: 'green' },
            rows: rows.filter(checked),
            value: { checked: true },
          },
          {
            option: { id: 'unchecked', name: text.unchecked, color: 'default' },
            rows: rows.filter((row) => !checked(row)),
            value: { checked: false },
          },
        ],
      },
    ];
  }
  const options: SelectOption[] =
    property.type === 'person' || property.type === 'relation'
      ? [
          ...new Set(
            text.referenceIds ?? rows.flatMap((row) => boardValueKeys(row.properties[property.id])),
          ),
        ].map((id) => ({ id, name: text.reference(id), color: 'default' }))
      : (property.config?.options ?? []);
  const buckets = new Map(options.map((option) => [option.id, [] as DatabaseRow[]]));
  const unassigned: DatabaseRow[] = [];
  for (const row of rows) {
    const keys = [...new Set(boardValueKeys(row.properties[property.id]))].filter((id) =>
      buckets.has(id),
    );
    if (keys.length === 0) unassigned.push(row);
    for (const id of keys) buckets.get(id)?.push(row);
  }
  const column = (option: SelectOption): BoardColumnData => ({
    option,
    rows: buckets.get(option.id) ?? [],
    value: assignment(property, [option.id]),
  });
  const none: BoardSection = {
    id: '__unassigned__',
    label: null,
    columns: [
      {
        option: { id: '__unassigned__', name: text.unassigned, color: 'default' },
        rows: unassigned,
        value: assignment(property, []),
      },
    ],
  };
  if (property.type !== 'status' || !property.config?.groups)
    return [{ id: 'options', label: null, columns: options.map(column) }, none];
  const byId = new Map(options.map((option) => [option.id, option]));
  return [
    ...statusGroups(options, property.config.groups).map((group) => ({
      id: group.id,
      label: text.statusGroup(group.id),
      columns: group.optionIds.flatMap((id) => {
        const option = byId.get(id);
        return option ? [column(option)] : [];
      }),
    })),
    none,
  ];
}
