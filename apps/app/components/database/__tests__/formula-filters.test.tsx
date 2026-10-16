import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
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
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer?.unmount()));
/** Every string the host tree renders (the portal's tree is not JSON-serialisable). */
function renderedText() {
  return renderer.root
    .findAll((node) => typeof node.type === 'string')
    .flatMap((node) => React.Children.toArray(node.props.children))
    .filter((child) => typeof child === 'string')
    .join(' ');
}
/** The outermost match: a Bloom control and the pressable inside it carry the same label. */
function pressable(label: string) {
  return renderer.root.findAll(
    (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function',
  )[0];
}
function render(type: 'formula' | 'unique_id', value: PropertyValue) {
  mockValue = value;
  const database = {
    id: 'db',
    schema: { properties: [{ id: 'computed', name: 'Computed', type }] },
  } as Database;
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <FilterBuilder
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
        />
      </BloomTestProviders>,
    );
  });
  // The toolbar button opens the dialog on the view's current filters.
  act(() => pressable('databases.toolbar.filterCount').props.onPress());
}
it.each(['formula', 'unique_id'] as const)(
  'sends numeric filter values for %s as numbers',
  async (type) => {
    render(type, { number: 12 });
    const input = renderer.root.findAll(
      (node) =>
        node.props.accessibilityLabel === 'databases.filters.value' &&
        typeof node.props.onChangeText === 'function',
    )[0];
    expect(input.props.keyboardType).toBe('numeric');
    act(() => input.props.onChangeText('42'));
    await act(async () => {
      await pressable('databases.actions.apply').props.onPress();
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
  expect(renderedText()).toContain('databases.filters.checked');
  expect(renderedText()).toContain('databases.filters.unchecked');
  expect(renderer.root.findAll((node) => node.props.onChangeText)).toHaveLength(0);
});
