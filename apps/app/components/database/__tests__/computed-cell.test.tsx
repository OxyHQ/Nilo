// The cells read people, files and rows through the API client and Oxy's session.
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({ isAuthenticated: false, oxyServices: {} }),
}));
jest.mock('../relation-cell', () => ({ RelationCell: () => null }));
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { PropertyCell } from '../property-cell';
import { propertyExpression, resultProperty, resultPropertyFromRows } from '@/lib/formula-results';
import type { DatabaseProperty, PropertyValue } from '@/lib/types/databases';

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    locale: 'en',
    t: (key: string, params?: { message: string }) => params?.message ?? key,
  }),
}));
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));
const formula: DatabaseProperty = { id: 'formula', name: 'Result', type: 'formula' };
let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer?.unmount()));
function render(value: PropertyValue, property = formula, readOnly = false) {
  const change = jest.fn();
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <PropertyCell property={property} value={value} onChange={change} readOnly={readOnly} />
      </BloomTestProviders>,
    );
  });
  return change;
}
it.each([false, true])('shows an actionable formula error in read-only=%s', (readOnly) => {
  const change = render({ text: '', error: 'Cycle detected' }, formula, readOnly);
  // The outermost match: a Bloom Button and the pressable inside it carry the same label.
  const trigger = renderer.root.findAll(
    (node) =>
      node.props.accessibilityLabel === 'Cycle detected' &&
      typeof node.props.onPress === 'function',
  )[0];
  act(() => trigger.props.onPress());
  expect(JSON.stringify(renderer.toJSON())).toContain('Cycle detected');
  expect(
    renderer.root.findAll((node) => node.props.accessibilityRole === 'alert').length,
  ).toBeGreaterThan(0);
  expect(change).not.toHaveBeenCalled();
});
it('formats numbers using the property format', () => {
  render({ number: 0.125 }, { ...formula, config: { format: 'percent', precision: 1 } });
  expect(JSON.stringify(renderer.toJSON())).toContain('12.5%');
});
it('renders a read-only checkbox result including false', () => {
  const change = render({ checked: false });
  const checkbox = renderer.root.findAll((node) => node.props.accessibilityRole === 'checkbox')[0];
  expect(checkbox.props).toMatchObject({
    'aria-checked': false,
    disabled: true,
    accessibilityLabel: 'Result',
  });
  expect(renderer.root.findAll((node) => node.props.onChangeText)).toHaveLength(0);
  expect(change).not.toHaveBeenCalled();
});
it('renders a date result', () => {
  render({ start: '2026-10-15T12:00:00Z' });
  expect(JSON.stringify(renderer.toJSON())).toContain('2026');
});
it.each(['TASK', ''])('renders ID prefix %s without an editor', (prefix) => {
  render({ number: 12 }, { id: 'id', name: 'ID', type: 'unique_id', config: { prefix } });
  expect(JSON.stringify(renderer.toJSON())).toContain(prefix ? 'TASK-12' : '12');
  expect(
    renderer.root.findAll((node) => node.props.onChangeText || node.props.onPress),
  ).toHaveLength(0);
});
it.each<[PropertyValue, string]>([
  [{ number: 0 }, 'number'],
  [{ text: 'a' }, 'text'],
  [{ checked: false }, 'checkbox'],
  [{ start: '2026-10-15' }, 'date'],
  [{ text: '', error: 'Cycle' }, 'text'],
  [null, 'text'],
])('infers filters from %j', (value, type) => {
  expect(resultProperty(formula, value).type).toBe(type);
});
it('escapes property names when inserting an expression', () => {
  expect(propertyExpression('A "quoted" \\ name')).toBe('prop("A \\"quoted\\" \\\\ name")');
});

it('types a formula by the first row whose result is not an error', () => {
  const formula = { id: 'f', name: 'F', type: 'formula', config: {} } as DatabaseProperty;
  const rows = [
    { properties: { f: { text: '', error: 'Division by zero' } } },
    { properties: { f: { number: 4 } } },
  ];
  expect(resultPropertyFromRows(formula, rows).type).toBe('number');
  expect(resultPropertyFromRows(formula, [rows[0] as (typeof rows)[number]]).type).toBe('text');
});
