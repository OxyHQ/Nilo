import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { useUIStore } from '@/lib/stores/ui-store';
import { CommandPalette } from '../command-palette';

const mockPush = jest.fn();
const mockRetry = jest.fn();
const mockCommand = jest.fn();
const mockPaletteArgs = jest.fn();
let mockSearch = { searchLoading: false, searchError: false };
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/components/page-chrome/icon-display', () => ({ IconDisplay: () => null }));
jest.mock('../use-palette-data', () => {
  const page = {
    kind: 'page',
    id: 'page:roadmap',
    pageId: 'roadmap',
    title: 'Roadmap',
    searchValue: 'Roadmap',
    subtitle: 'Workspace',
    snippet: [{ text: 'the plan', match: true }],
  };
  return {
    usePaletteData: (args: unknown) => ({
      ...(mockPaletteArgs(args) as object),
      recents: [page],
      pages: [page],
      members: [],
      commands: [
        {
          kind: 'command',
          id: 'cmd:new-page',
          title: 'New page',
          searchValue: 'new page',
          shortcut: 'N',
          onSelect: mockCommand,
        },
      ],
      ...mockSearch,
      retrySearch: mockRetry,
      filterOptions: {
        people: [{ id: 'ada', name: 'Ada' }],
        teamspaces: [{ id: 'eng', name: 'Engineering' }],
      },
    }),
  };
});

let renderer: ReactTestRenderer;

async function mount() {
  useUIStore.getState().setCommandPaletteOpen(true);
  await act(async () => {
    renderer = create(
      <BloomTestProviders>
        <CommandPalette />
      </BloomTestProviders>,
    );
  });
}

// The palette's Bloom `Item` rows, by the props this file gives them.
const rows = () =>
  renderer.root.findAll(
    (node) =>
      node.props.role === 'option' && node.props.density === 'compact' && !!node.props.title,
    { deep: false },
  );
const text = () =>
  renderer.root
    .findAll((node) => typeof node.type === 'string')
    .flatMap((node) => [node.props.children].flat())
    .filter((child) => typeof child === 'string')
    .join(' ');

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = { searchLoading: false, searchError: false };
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  useUIStore.getState().setCommandPaletteOpen(false);
});

it('lists recents, pages and commands, highlighting only the first row', async () => {
  await mount();
  expect(rows().map((row) => row.props.title)).toEqual(['Roadmap', 'Roadmap', 'New page']);
  // Recents reuse the page objects; the highlight still lands on one row.
  expect(rows().map((row) => row.props.selected)).toEqual([true, false, false]);
  expect(text()).toContain('commandPalette.groups.recent');
  expect(text()).toContain('the plan');
});

it('opens a page and closes the palette', async () => {
  await mount();
  act(() => rows()[1].props.onPress());
  expect(mockPush).toHaveBeenCalledWith('/p/roadmap');
  expect(useUIStore.getState().commandPaletteOpen).toBe(false);
});

it('runs a command on press', async () => {
  await mount();
  act(() => rows()[2].props.onPress());
  expect(mockCommand).toHaveBeenCalledTimes(1);
});

it('retries a failed search', async () => {
  mockSearch = { searchLoading: false, searchError: true };
  await mount();
  act(() => {
    renderer.root
      .findAll(
        (node) =>
          node.props.accessibilityLabel === 'commandPalette.placeholder' && node.props.onChangeText,
      )[0]
      .props.onChangeText('plan');
  });
  expect(text()).toContain('commandPalette.search.error');
  act(() => {
    renderer.root
      .findAll(
        (node) =>
          node.props.accessibilityLabel === 'commandPalette.search.retry' && node.props.onPress,
      )[0]
      .props.onPress();
  });
  expect(mockRetry).toHaveBeenCalledTimes(1);
});

it('narrows the search with its filters, and opens without them', async () => {
  await mount();
  const titleOnly = () =>
    renderer.root.findAll(
      (node) =>
        node.props.accessibilityLabel === 'commandPalette.filters.titleOnly' && node.props.onPress,
    )[0];
  expect(titleOnly().props.selected).toBe(false);
  act(() => titleOnly().props.onPress());
  expect(titleOnly().props.selected).toBe(true);
  expect(mockPaletteArgs).toHaveBeenLastCalledWith(
    expect.objectContaining({
      enabled: true,
      filters: expect.objectContaining({ titleOnly: true, createdBy: null }),
    }),
  );
  // Closed and opened again: no filter left over.
  await act(async () => useUIStore.getState().setCommandPaletteOpen(false));
  await act(async () => useUIStore.getState().setCommandPaletteOpen(true));
  expect(mockPaletteArgs).toHaveBeenLastCalledWith(
    expect.objectContaining({ filters: expect.objectContaining({ titleOnly: false }) }),
  );
});
