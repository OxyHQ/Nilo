import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FormulaEditor } from '../formula-editor';
import { ComputedCell } from '../computed-cell';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { Database, DatabaseProperty } from '@/lib/types/databases';

const mockUpdate = jest.fn();
const mockRefetch = jest.fn();
jest.mock('@/lib/fonts', () => ({ MONO_FONT_FAMILY: 'monospace' }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ locale: 'en', t: (key: string) => key }),
}));
jest.mock('@/lib/hooks/use-database-properties', () => ({
  useUpdateProperty: () => ({ mutateAsync: mockUpdate }),
}));
jest.mock('@/lib/hooks/use-database-rows', () => ({
  useDatabaseRows: () => ({ refetch: mockRefetch }),
}));
const property: DatabaseProperty = {
  id: 'f',
  name: 'Formula',
  type: 'formula',
  config: { expression: '1 + 2', format: 'percent' },
};
const database = {
  id: 'db',
  schema: { properties: [{ id: 'name', name: 'Name', type: 'text' }, property] },
} as Database;
let renderer: ReactTestRenderer;
beforeEach(() => {
  jest.clearAllMocks();
  act(() => {
    renderer = create(<FormulaEditor database={database} property={property} onDone={jest.fn()} />);
  });
});
afterEach(() => act(() => renderer.unmount()));
const save = () =>
  renderer.root
    .findAllByType(Button)
    .find((button) => button.props.children?.props?.children === 'common.save')!;
it('saves the expression and displays only the refreshed server result', async () => {
  let resolve: (data: unknown) => void = () => {};
  mockRefetch.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await act(async () => save().props.onPress());
  expect(mockUpdate).toHaveBeenCalledWith({
    databaseId: 'db',
    propertyId: 'f',
    config: { expression: '1 + 2', format: 'percent' },
  });
  expect(renderer.root.findAllByType(ComputedCell)).toHaveLength(0);
  await act(async () => resolve({ data: { rows: [{ properties: { f: { number: 27 } } }] } }));
  expect(renderer.root.findByType(ComputedCell).props.value).toEqual({ number: 27 });
  act(() => renderer.root.findByType(Textarea).props.onChangeText('4 + 5'));
  expect(renderer.root.findAllByType(ComputedCell)).toHaveLength(0);
});
it('previews a server formula error and reports refresh failures', async () => {
  mockRefetch.mockResolvedValueOnce({
    data: { rows: [{ properties: { f: { text: '', error: 'Cycle' } } }] },
  });
  await act(async () => save().props.onPress());
  expect(renderer.root.findByType(ComputedCell).props.value.error).toBe('Cycle');
  mockRefetch.mockResolvedValueOnce({ isError: true });
  await act(async () => save().props.onPress());
  expect(JSON.stringify(renderer.toJSON())).toContain('databases.formula.refreshFailed');
  expect(renderer.root.findAllByType(ComputedCell)).toHaveLength(0);
});
it('inserts a property at the selected cursor range', () => {
  act(() =>
    renderer.root
      .findByType(Textarea)
      .props.onSelectionChange({ nativeEvent: { selection: { start: 0, end: 1 } } }),
  );
  const picker = renderer.root
    .findAllByType(Button)
    .find((button) => button.props.children?.props?.children === 'Name')!;
  act(() => picker.props.onPress());
  expect(renderer.root.findByType(Textarea).props.value).toBe('prop("Name") + 2');
});
