import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Platform } from 'react-native';
import { DatabaseViewContainer } from '../database-view';
import { PropertyCell } from '../property-cell';
import type { Database, DatabaseRow, DatabaseView, DatabaseViewType } from '@/lib/types/databases';

jest.mock('@/components/ui/dropdown-menu', () => {
  const { View, Text } = require('react-native');
  return {
    Root: View,
    Trigger: View,
    Content: View,
    Item: View,
    ItemTitle: Text,
    Separator: View,
    Sub: View,
    SubTrigger: View,
    SubContent: View,
  };
});
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/hooks/use-forms', () => ({
  useFormLink: jest.fn(),
  useChangeFormLink: jest.fn(),
}));
jest.mock('@/lib/hooks/use-row-templates', () => ({
  useRowTemplates: () => ({ data: { templates: [] } }),
  useCreateRowTemplate: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/lib/hooks/use-database-views', () => ({ useUpdateView: jest.fn() }));

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: 'en' }),
}));
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/hooks/use-database-rows', () => ({
  useCreateRow: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useUpdateRow: () => ({ mutate: jest.fn() }),
}));
jest.mock('../property-config-modal', () => ({
  AddPropertyButton: () => null,
  PropertyHeaderMenu: () => null,
}));
jest.mock('../filter-builder', () => ({ FilterBuilder: () => null }));
jest.mock('../sort-builder', () => ({ SortBuilder: () => null }));

const database: Database = {
  id: 'db',
  teamspaceId: null,
  workspaceId: 'workspace',
  name: 'Projects',
  icon: null,
  cover: null,
  ownerId: 'owner',
  isInline: true,
  parentPageId: 'parent',
  archived: false,
  createdAt: '',
  updatedAt: '',
  schema: {
    properties: [
      {
        id: 'status',
        name: 'Status',
        type: 'status',
        config: { options: [{ id: 'done', name: 'Done', color: 'green' }] },
      },
      { id: 'checked', name: 'Checked', type: 'checkbox' },
    ],
  },
};
const view: DatabaseView = {
  id: 'view',
  databaseId: 'db',
  name: 'Table',
  type: 'table',
  isDefault: true,
  filters: { kind: 'group', combinator: 'and', filters: [] },
  sorts: [],
  groupBy: { propertyId: 'status' },
  hiddenProperties: [],
  frozenProperties: [],
  pageSize: 50,
  config: {},
  order: 0,
  createdAt: '',
  updatedAt: '',
};
const rows: DatabaseRow[] = [
  {
    id: 'row',
    workspaceId: 'workspace',
    parentId: 'parent',
    databaseId: 'db',
    title: 'A project',
    icon: null,
    cover: null,
    ownerId: 'owner',
    archived: false,
    order: 0,
    properties: { status: { optionId: 'done' }, checked: { checked: true } },
    createdAt: '',
    updatedAt: '',
  },
];

let renderer: ReactTestRenderer;
const originalOS = Platform.OS;
beforeEach(() => {
  Platform.OS = 'web';
});
afterEach(() => {
  act(() => renderer?.unmount());
  Platform.OS = originalOS;
});

it.each<DatabaseViewType>(['table', 'board', 'gallery', 'list'])(
  '%s hides editing controls but retains rows in read-only mode',
  (type) => {
    act(() => {
      renderer = create(
        <DatabaseViewContainer
          database={database}
          view={{ ...view, type }}
          rows={rows}
          isLoading={false}
          readOnly
        />,
      );
    });
    expect(renderer.root.findAllByType(PropertyCell).length).toBeGreaterThan(0);
    expect(renderer.root.findAllByType(PropertyCell).every((cell) => cell.props.readOnly)).toBe(
      true,
    );
    expect(
      renderer.root
        .findAll((node) => Boolean(node.props.onPress))
        .filter((node) => node.props.accessibilityLabel === 'databases.actions.new'),
    ).toHaveLength(0);
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
    expect(renderer.root.findAll((node) => node.props.draggable || node.props.onDrop)).toHaveLength(
      0,
    );
    expect(JSON.stringify(renderer.toJSON())).toContain('A project');
  },
);

it('keeps table editing and creation available to editors', () => {
  act(() => {
    renderer = create(
      <DatabaseViewContainer database={database} view={view} rows={rows} isLoading={false} />,
    );
  });
  expect(renderer.root.findAllByType('input').length).toBeGreaterThan(0);
  expect(
    renderer.root
      .findAll((node) => Boolean(node.props.onPress))
      .some((node) => node.props.accessibilityLabel === 'databases.actions.new'),
  ).toBe(true);
});

it('keeps the form builder and management requests unavailable in read-only mode', () => {
  act(() => {
    renderer = create(
      <DatabaseViewContainer
        database={database}
        view={{ ...view, type: 'form' }}
        rows={rows}
        isLoading={false}
        readOnly
      />,
    );
  });
  expect(JSON.stringify(renderer.toJSON())).toContain('databases.form.editorsOnly');
  expect(renderer.root.findAll((node) => Boolean(node.props.onPress))).toHaveLength(0);
});
