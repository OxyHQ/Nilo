import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { DatabasePicker } from '../database-picker';
const mockDatabases = jest.fn();
jest.mock('@/lib/hooks/use-databases', () => ({ useDatabases: (id: string) => mockDatabases(id) }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// The dialog's body renders in place; closing it settles at once, running the
// close callback and then `onClose`, as Bloom's does once its exit has run.
jest.mock('@oxy.so/bloom/dialog', () => {
  const { useImperativeHandle } = require('react');
  const { View } = require('react-native');
  return {
    ...jest.requireActual('@oxy.so/bloom/dialog'),
    Dialog: ({
      control,
      onClose,
      children,
    }: {
      control?: { ref: unknown };
      onClose?: () => void;
      children?: React.ReactNode;
    }) => {
      useImperativeHandle(control?.ref as never, () => ({
        open: () => {},
        close: (cb?: () => void) => {
          cb?.();
          onClose?.();
        },
      }));
      return <View>{children}</View>;
    },
  };
});
let renderer: ReactTestRenderer;
// `Item` is memoised, so it is found by its props rather than its type.
const items = () =>
  renderer.root.findAll(
    (node) => typeof node.props.title === 'string' && typeof node.props.onPress === 'function',
  );
afterEach(() => act(() => renderer.unmount()));
it('searches the access-filtered workspace list by name and picks the database id', () => {
  const choose = jest.fn();
  mockDatabases.mockReturnValue({
    data: {
      databases: [
        { id: 'projects', name: 'Proyectos', archived: false },
        { id: 'meetings', name: 'Reunión', archived: false },
        { id: 'archived', name: 'Reunión archivada', archived: true },
      ],
    },
  });
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <DatabasePicker workspaceId="workspace" onChoose={choose} onClose={jest.fn()} />
      </BloomTestProviders>,
    );
  });
  expect(mockDatabases).toHaveBeenCalledWith('workspace');
  expect(items()).toHaveLength(2);
  act(() => renderer.root.findByType(TextFieldInput).props.onChangeText('  REUNION  '));
  const [item] = items();
  expect(items()).toHaveLength(1);
  expect(item.props.accessibilityLabel).toBe('Reunión');
  act(() => item.props.onPress());
  expect(choose).toHaveBeenCalledWith('meetings');
});
