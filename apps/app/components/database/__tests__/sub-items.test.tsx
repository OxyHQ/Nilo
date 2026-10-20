import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { nestSubItems, subItemProperties } from '@/lib/sub-items';
import { ViewList } from '../view-list';
import { ViewTable } from '../view-table';
import { SubItemToggle, NewSubItem } from '../sub-item-controls';
import type { Database, DatabaseRow, DatabaseView } from '@/lib/types/databases';

const mockCreateRow = jest.fn();
// A group of people shows their profiles, which these tests do not read.
jest.mock('../person-cell', () => ({ PersonChips: () => null }));
jest.mock('@/lib/hooks/use-view-data', () => ({
  useViewCalculations: () => ({ data: undefined }),
  useViewChart: () => ({ data: undefined, isLoading: false }),
}));
jest.mock('@/lib/hooks/use-database-rows', () => ({
  useCreateRow: () => ({ mutate: mockCreateRow }),
  useUpdateRow: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/lib/hooks/use-database-views', () => ({
  useUpdateView: () => ({ mutate: jest.fn() }),
}));
jest.mock('../property-cell', () => ({ PropertyCell: () => null }));
jest.mock('../property-config-modal', () => ({ PropertyHeaderMenu: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
const database = {
  id: 'db',
  schema: {
    properties: [
      {
        id: 'children',
        name: 'Renamed children',
        type: 'relation',
        config: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'parent' },
      },
      {
        id: 'parent',
        name: 'Renamed parent',
        type: 'relation',
        config: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'children' },
      },
    ],
  },
} as Database;
const view = { hiddenProperties: [] } as unknown as DatabaseView;
function row(id: string, parent?: string): DatabaseRow {
  return {
    id,
    title: id,
    properties: parent ? { parent: { pageIds: [parent] } } : {},
  } as DatabaseRow;
}
const rows = [
  row('child', 'root'),
  row('root'),
  row('orphan', 'filtered'),
  row('grandchild', 'child'),
];
let renderer: ReactTestRenderer;
afterEach(() => {
  if (renderer) act(() => renderer.unmount());
  jest.clearAllMocks();
});
it('uses reciprocal ids even after renaming, keeps orphans at root and starts collapsed', () => {
  expect(subItemProperties(database)?.parent.id).toBe('parent');
  expect(nestSubItems(rows, 'parent', new Set())).toEqual([
    { kind: 'row', row: rows[1], depth: 0 },
    { kind: 'row', row: rows[2], depth: 0 },
  ]);
  const nested = nestSubItems(rows, 'parent', new Set(['root', 'child']));
  expect(
    nested.filter((entry) => entry.kind === 'row').map((entry) => [entry.row.id, entry.depth]),
  ).toEqual([
    ['root', 0],
    ['child', 1],
    ['grandchild', 2],
    ['orphan', 0],
  ]);
});
it('breaks cycles and displays each row once', () => {
  const nested = nestSubItems(
    [row('a', 'b'), row('b', 'a'), row('self', 'self')],
    'parent',
    new Set(['a', 'b', 'self']),
  );
  expect(
    nested
      .filter((entry) => entry.kind === 'row')
      .map((entry) => entry.row.id)
      .sort(),
  ).toEqual(['a', 'b', 'self']);
});
it.each([ViewList, ViewTable])(
  'renders nested children and creates a sub-item with its parent link',
  (Component) => {
    act(() => {
      renderer = create(
        <BloomTestProviders>
          <Component database={database} view={view} rows={rows} isLoading={false} />
        </BloomTestProviders>,
      );
    });
    expect(renderer.root.findAllByType(SubItemToggle).map((node) => node.props.title)).toEqual([
      'root',
      'orphan',
    ]);
    expect(renderer.root.findAllByType(NewSubItem)).toHaveLength(0);
    act(() => renderer.root.findAllByType(SubItemToggle)[0].props.onPress());
    expect(renderer.root.findAllByType(SubItemToggle).map((node) => node.props.title)).toEqual([
      'root',
      'child',
      'orphan',
    ]);
    act(() => renderer.root.findByType(NewSubItem).props.onPress());
    expect(mockCreateRow).toHaveBeenCalledWith({
      databaseId: 'db',
      properties: { parent: { pageIds: ['root'] } },
    });
    act(() => renderer.root.findAllByType(SubItemToggle)[0].props.onPress());
    expect(renderer.root.findAllByType(SubItemToggle).map((node) => node.props.title)).toEqual([
      'root',
      'orphan',
    ]);
  },
);
it.each([ViewList, ViewTable])('allows read-only expansion without creation', (Component) => {
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <Component database={database} view={view} rows={rows} isLoading={false} readOnly />
      </BloomTestProviders>,
    );
  });
  act(() => renderer.root.findAllByType(SubItemToggle)[0].props.onPress());
  expect(renderer.root.findAllByType(SubItemToggle)).toHaveLength(3);
  expect(renderer.root.findAllByType(NewSubItem)).toHaveLength(0);
});
