import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { DatabasePicker } from '../database-picker';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
const mockDatabases = jest.fn();
jest.mock('@/lib/hooks/use-databases', () => ({ useDatabases: (id: string) => mockDatabases(id) }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/components/ui/dialog', () => {
  const { View, Text } = require('react-native');
  return { Dialog: View, DialogContent: View, DialogTitle: Text };
});
let renderer: ReactTestRenderer;
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
      <DatabasePicker workspaceId="workspace" onChoose={choose} onClose={jest.fn()} />,
    );
  });
  expect(mockDatabases).toHaveBeenCalledWith('workspace');
  expect(renderer.root.findAllByType(Button)).toHaveLength(2);
  act(() => renderer.root.findByType(Input).props.onChangeText('  REUNION  '));
  const button = renderer.root.findByType(Button);
  expect(button.props.accessibilityLabel).toBe('Reunión');
  act(() => button.props.onPress());
  expect(choose).toHaveBeenCalledWith('meetings');
});
