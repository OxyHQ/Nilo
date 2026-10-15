import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FilterBuilder } from '../filter-builder';
import type { Database, DatabaseRow, DatabaseView, PropertyValue } from '@/lib/types/databases';

const mockUpdate = jest.fn();
let mockValue: PropertyValue;
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));
jest.mock('@/lib/hooks/use-database-views', () => ({
  useUpdateView: () => ({ mutateAsync: mockUpdate }),
}));
const view = {
  id: 'view',
  filters: {
    kind: 'group',
    combinator: 'and',
    filters: [{ kind: 'condition', propertyId: 'computed', operator: '=', value: 0 }],
  },
} as DatabaseView;
let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer?.unmount()));
function render(type: 'formula' | 'unique_id', value: PropertyValue) {
  mockValue = value;
  const database = {
    id: 'db',
    schema: { properties: [{ id: 'computed', name: 'Computed', type }] },
  } as Database;
  act(() => {
    renderer = create(
      <FilterBuilder
        open
        rows={[
          {
            id: 'row',
            workspaceId: 'workspace',
            parentId: null,
            databaseId: 'db',
            title: 'Row',
            icon: null,
            cover: null,
            ownerId: 'owner',
            archived: false,
            order: 0,
            properties: { computed: mockValue },
            createdAt: '',
            updatedAt: '',
          } satisfies DatabaseRow,
        ]}
        database={database}
        view={view}
        onClose={jest.fn()}
      />,
    );
  });
}
it.each(['formula', 'unique_id'] as const)(
  'sends numeric filter values for %s as numbers',
  async (type) => {
    render(type, { number: 12 });
    const input = renderer.root.find(
      (node) =>
        node.props.accessibilityLabel === 'databases.filters.value' &&
        typeof node.props.onChangeText === 'function',
    );
    expect(input.props.keyboardType).toBe('numeric');
    act(() => input.props.onChangeText('42'));
    await act(async () => {
      await renderer.root
        .find(
          (node) =>
            node.props.accessibilityLabel === 'databases.actions.apply' &&
            typeof node.props.onPress === 'function',
        )
        .props.onPress();
    });
    expect(mockUpdate).toHaveBeenLastCalledWith({
      databaseId: 'db',
      viewId: 'view',
      filters: {
        kind: 'group',
        combinator: 'and',
        filters: [{ kind: 'condition', propertyId: 'computed', operator: '=', value: 42 }],
      },
    });
  },
);
it('offers checkbox values for a false formula result', () => {
  render('formula', { checked: false });
  expect(JSON.stringify(renderer.toJSON())).toContain('databases.filters.checked');
  expect(JSON.stringify(renderer.toJSON())).toContain('databases.filters.unchecked');
  expect(renderer.root.findAll((node) => node.props.onChangeText)).toHaveLength(0);
});
