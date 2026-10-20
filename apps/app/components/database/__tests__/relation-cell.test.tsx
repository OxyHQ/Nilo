import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { PropertyCell } from '../property-cell';
import { RelatedRowsProvider } from '../relation-cell';
import { RowPropertiesPanel } from '../row-properties-panel';
import { useDatabaseRow, useRelatedRowSets, useRelatedRows } from '@/lib/hooks/use-database-rows';
import type { Database, DatabaseRow } from '@/lib/types/databases';
const mockPush = jest.fn();
// The cells read people, files and rows through the API client and Oxy's session.
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({ isAuthenticated: false, oxyServices: {} }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));
jest.mock('@/lib/hooks/use-database-rows', () => ({
  useDatabaseRow: jest.fn(),
  useRelatedRows: jest.fn(),
  useRelatedRowSets: jest.fn(),
  useUpdateRow: () => ({ mutate: jest.fn() }),
}));
let renderer: ReactTestRenderer;
beforeEach(() => jest.clearAllMocks());
afterEach(() => act(() => renderer?.unmount()));
it.each([false, true])(
  'shows and opens related row titles on both sides, readOnly=%s',
  (readOnly) => {
    jest.mocked(useRelatedRows).mockImplementation(
      (_db, ids) =>
        ({
          data: ids.map((id) => ({ id, title: id === 'project' ? 'Launch' : 'Design' })),
        }) as ReturnType<typeof useRelatedRows>,
    );
    act(() => {
      renderer = create(
        <BloomTestProviders>
          <PropertyCell
            property={{
              id: 'project',
              name: 'Project',
              type: 'relation',
              config: { targetDatabaseId: 'projects' },
            }}
            value={{ pageIds: ['project'] }}
            readOnly={readOnly}
            onChange={jest.fn()}
          />
          <PropertyCell
            property={{
              id: 'task',
              name: 'Task',
              type: 'relation',
              config: { targetDatabaseId: 'tasks' },
            }}
            value={{ pageIds: ['task'] }}
            readOnly={readOnly}
            onChange={jest.fn()}
          />
        </BloomTestProviders>,
      );
    });
    expect(useRelatedRows).toHaveBeenCalledWith('projects', ['project']);
    expect(useRelatedRows).toHaveBeenCalledWith('tasks', ['task']);
    const pill = renderer.root.find(
      (node) => node.props?.accessibilityLabel === 'Launch' && node.props.onPress,
    );
    // The pill sits in a pressable cell or card that opens the row.
    expect(pill.props.stopPropagation).toBe(true);
    act(() => pill.props.onPress());
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/p/[pageId]',
      params: { pageId: 'project' },
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('Design');
  },
);

it('reads every related row of a cell in one request, and marks the ones gone', () => {
  jest.mocked(useRelatedRows).mockReturnValue({
    data: [
      { id: 'a', title: 'Alpha' },
      { id: 'c', title: '' },
    ],
  } as ReturnType<typeof useRelatedRows>);
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <PropertyCell
          property={{ id: 'rel', name: 'Rel', type: 'relation', config: { targetDatabaseId: 't' } }}
          value={{ pageIds: ['a', 'b', 'c'] }}
          onChange={jest.fn()}
        />
      </BloomTestProviders>,
    );
  });
  expect(useRelatedRows).toHaveBeenCalledTimes(1);
  expect(useRelatedRows).toHaveBeenCalledWith('t', ['a', 'b', 'c']);
  const labels = renderer.root
    .findAll((node) => node.props?.stopPropagation === true && node.props.onPress)
    .map((node) => node.props.accessibilityLabel);
  expect([...new Set(labels)]).toEqual([
    'Alpha',
    'databases.relations.unavailable',
    'databases.untitled',
  ]);
});

it('the row page uses fresh row-query properties without reloading the editor page', () => {
  const property = {
    id: 'rel',
    name: 'Related',
    type: 'relation',
    config: { targetDatabaseId: 'target' },
  };
  const database = { id: 'db', schema: { properties: [property] } } as Database;
  const row = { id: 'row', properties: { rel: { pageIds: ['old'] } } } as unknown as DatabaseRow;
  jest.mocked(useDatabaseRow).mockReturnValue({
    data: { ...row, properties: { rel: { pageIds: ['new'] } } },
  } as unknown as ReturnType<typeof useDatabaseRow>);
  jest
    .mocked(useRelatedRows)
    .mockImplementation(
      (_db, ids) =>
        ({ data: ids.map((id) => ({ id, title: 'New relation' })) }) as ReturnType<
          typeof useRelatedRows
        >,
    );
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <RowPropertiesPanel database={database} row={row} readOnly />
      </BloomTestProviders>,
    );
  });
  expect(useDatabaseRow).toHaveBeenCalledWith('db', 'row');
  expect(useRelatedRows).toHaveBeenCalledWith('target', ['new']);
  expect(useRelatedRows).not.toHaveBeenCalledWith('target', ['old']);
  expect(JSON.stringify(renderer.toJSON())).toContain('New relation');
});

it('reads the related rows of every row of a view once, a cell reading only what it lists apart', () => {
  const property = {
    id: 'rel',
    name: 'Rel',
    type: 'relation',
    config: { targetDatabaseId: 't' },
  } as const;
  const database = { id: 'db', schema: { properties: [property] } } as unknown as Database;
  const rows = [
    { id: 'r1', properties: { rel: { pageIds: ['b', 'a'] } } },
    { id: 'r2', properties: { rel: { pageIds: ['a', 'c'] } } },
  ] as unknown as DatabaseRow[];
  jest.mocked(useRelatedRowSets).mockReturnValue(
    new Map([
      [
        't',
        {
          requested: new Set(['a', 'b', 'c']),
          // The set is being read again: `c` is not read yet.
          readIds: new Set(['a', 'b']),
          rows: new Map([['a', { id: 'a', title: 'Alpha' } as DatabaseRow]]),
          isError: false,
        },
      ],
    ]),
  );
  jest
    .mocked(useRelatedRows)
    .mockImplementation(
      (_db, ids) =>
        ({ data: ids.map((id) => ({ id, title: `Own ${id}` })) }) as ReturnType<
          typeof useRelatedRows
        >,
    );
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <RelatedRowsProvider database={database} rows={rows}>
          <PropertyCell
            property={property}
            value={{ pageIds: ['a', 'b', 'c', 'd'] }}
            readOnly
            onChange={jest.fn()}
          />
        </RelatedRowsProvider>
      </BloomTestProviders>,
    );
  });
  expect(useRelatedRowSets).toHaveBeenCalledWith([{ databaseId: 't', ids: ['a', 'b', 'c'] }]);
  expect(useRelatedRows).toHaveBeenCalledWith('t', ['d']);
  const labels = renderer.root
    .findAll((node) => node.props?.stopPropagation === true && node.props.onPress)
    .map((node) => node.props.accessibilityLabel);
  expect([...new Set(labels)]).toEqual([
    'Alpha',
    'databases.relations.unavailable',
    'common.loading',
    'Own d',
  ]);
});
