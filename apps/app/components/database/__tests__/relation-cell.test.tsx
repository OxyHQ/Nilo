import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { PropertyCell } from '../property-cell';
import { RowPropertiesPanel } from '../row-properties-panel';
import { useDatabaseRow } from '@/lib/hooks/use-database-rows';
import type { Database, DatabaseRow } from '@/lib/types/databases';
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));
jest.mock('@/lib/hooks/use-database-rows', () => ({
  useDatabaseRow: jest.fn(),
  useUpdateRow: () => ({ mutate: jest.fn() }),
}));
let renderer: ReactTestRenderer;
beforeEach(() => jest.clearAllMocks());
afterEach(() => act(() => renderer?.unmount()));
it.each([false, true])(
  'shows and opens related row titles on both sides, readOnly=%s',
  (readOnly) => {
    jest
      .mocked(useDatabaseRow)
      .mockImplementation(
        (_db, id) =>
          ({ data: { id, title: id === 'project' ? 'Launch' : 'Design' } }) as ReturnType<
            typeof useDatabaseRow
          >,
      );
    act(() => {
      renderer = create(
        <>
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
        </>,
      );
    });
    expect(useDatabaseRow).toHaveBeenCalledWith('projects', 'project');
    expect(useDatabaseRow).toHaveBeenCalledWith('tasks', 'task');
    const event = { stopPropagation: jest.fn() };
    act(() =>
      renderer.root
        .find((node) => node.props?.accessibilityLabel === 'Launch' && node.props.onPress)
        .props.onPress(event),
    );
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/p/[pageId]',
      params: { pageId: 'project' },
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('Design');
  },
);
it('the row page uses fresh row-query properties without reloading the editor page', () => {
  const property = {
    id: 'rel',
    name: 'Related',
    type: 'relation',
    config: { targetDatabaseId: 'target' },
  };
  const database = { id: 'db', schema: { properties: [property] } } as Database;
  const row = { id: 'row', properties: { rel: { pageIds: ['old'] } } } as unknown as DatabaseRow;
  jest.mocked(useDatabaseRow).mockImplementation(
    (_db, id) =>
      ({
        data:
          id === 'row'
            ? { ...row, properties: { rel: { pageIds: ['new'] } } }
            : { id, title: 'New relation' },
      }) as ReturnType<typeof useDatabaseRow>,
  );
  act(() => {
    renderer = create(<RowPropertiesPanel database={database} row={row} readOnly />);
  });
  expect(useDatabaseRow).toHaveBeenCalledWith('db', 'row');
  expect(useDatabaseRow).toHaveBeenCalledWith('target', 'new');
  expect(useDatabaseRow).not.toHaveBeenCalledWith('target', 'old');
  expect(JSON.stringify(renderer.toJSON())).toContain('New relation');
});
