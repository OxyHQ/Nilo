import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { PropertyCell } from '../property-cell';
import type { DatabaseProperty } from '@/lib/types/databases';

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: 'en-US' }),
}));
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));
jest.mock('@/lib/hooks/use-database-rows', () => ({ useRelatedRows: () => ({}) }));

const amount: DatabaseProperty = {
  id: 'amount',
  name: 'Amount',
  type: 'number',
  config: { format: 'currency:USD', precision: 2 },
};

let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer?.unmount()));

it('shows a table’s number in its format, and the number itself while it is edited', () => {
  const onChange = jest.fn();
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <PropertyCell
          property={amount}
          value={{ number: 1200 }}
          variant="table"
          onChange={onChange}
        />
      </BloomTestProviders>,
    );
  });
  const input = () => renderer.root.findAllByType(TextInput)[0];
  expect(input()?.props.value).toBe('$1,200.00');
  act(() => input()?.props.onFocus());
  expect(input()?.props.value).toBe('1200');
  act(() => input()?.props.onChangeText('1500'));
  act(() => input()?.props.onBlur());
  expect(onChange).toHaveBeenCalledWith({ number: 1500 });
});
