import { Platform } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { moveItem, SortBuilder } from '../sort-builder';
import type { Database, DatabaseView, ViewSort } from '@/lib/types/databases';

const mockUpdate = jest.fn();
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: 'en' }),
}));
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));
jest.mock('@/lib/hooks/use-database-views', () => ({
  useUpdateView: () => ({ mutateAsync: mockUpdate }),
}));

const database = {
  id: 'db',
  schema: {
    properties: [
      { id: 'name', name: 'Name', type: 'text' },
      { id: 'points', name: 'Points', type: 'number' },
      { id: 'due', name: 'Due', type: 'date' },
    ],
  },
} as Database;
const sorts: ViewSort[] = [
  { propertyId: 'name', direction: 'asc' },
  { propertyId: 'points', direction: 'desc' },
  { propertyId: 'due', direction: 'asc' },
];

let renderer: ReactTestRenderer;
beforeEach(() => jest.clearAllMocks());
afterEach(() => act(() => renderer?.unmount()));

function render() {
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <SortBuilder database={database} view={{ id: 'view', sorts } as DatabaseView} />
      </BloomTestProviders>,
    );
  });
  act(() => byLabel('databases.toolbar.sortCount')[0]?.props.onPress());
}
function byLabel(label: string) {
  return renderer.root
    .findAllByType(Button)
    .filter((node) => node.props.accessibilityLabel === label);
}
async function apply() {
  await act(async () => {
    await renderer.root
      .findAllByType(Button)
      .find((node) => node.props.children === 'databases.actions.apply')
      ?.props.onPress();
  });
  return mockUpdate.mock.calls.at(-1)?.[0].sorts;
}

it('moves a sort up and down its priority, never past either end', async () => {
  render();
  const up = byLabel('databases.sorts.moveUp');
  const down = byLabel('databases.sorts.moveDown');
  expect(up[0]?.props.disabled).toBe(true);
  expect(down[2]?.props.disabled).toBe(true);
  // Due first, then Name: up twice, then Name down past Points.
  act(() => byLabel('databases.sorts.moveUp')[2]?.props.onPress());
  act(() => byLabel('databases.sorts.moveUp')[1]?.props.onPress());
  act(() => byLabel('databases.sorts.moveDown')[1]?.props.onPress());
  expect(await apply()).toEqual([sorts[2], sorts[1], sorts[0]]);
});

it('removes a sort, keeping the others in their order', async () => {
  render();
  act(() => byLabel('common.delete')[1]?.props.onPress());
  expect(await apply()).toEqual([sorts[0], sorts[2]]);
});

it('drops a sort dragged on web in the place of the one it lands on', async () => {
  const originalOS = Platform.OS;
  Platform.OS = 'web';
  try {
    render();
    const rows = () =>
      renderer.root.findAll(
        (node) =>
          typeof node.type === 'string' &&
          node.props.draggable === true &&
          typeof node.props.onDrop === 'function',
      );
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
    };
    act(() => rows()[2]?.props.onDragStart({ dataTransfer }));
    act(() => rows()[0]?.props.onDrop({ preventDefault: jest.fn(), dataTransfer }));
    // Something else dropped (a file) moves nothing.
    act(() =>
      rows()[1]?.props.onDrop({ preventDefault: jest.fn(), dataTransfer: { getData: () => '' } }),
    );
    expect(await apply()).toEqual([sorts[2], sorts[0], sorts[1]]);
  } finally {
    Platform.OS = originalOS;
  }
});

it('moves one item of a list to another place', () => {
  expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
});
