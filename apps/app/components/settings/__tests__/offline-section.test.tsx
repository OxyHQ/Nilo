import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import type { OfflineEntry } from '@/lib/editor/offline-pages';
import { formatSize, OfflineSection } from '../offline-section';

const mockPush = jest.fn();
const mockStore = {
  setPinned: jest.fn(async (_id: string, _pinned: boolean) => undefined),
  clear: jest.fn(async () => undefined),
};
let mockList: { supported: boolean; pages: OfflineEntry[] } = { supported: true, pages: [] };
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/editor/offline-pages', () => ({
  offlinePages: {
    setPinned: (...args: [string, boolean]) => mockStore.setPinned(...args),
    clear: () => mockStore.clear(),
  },
}));
jest.mock('@/lib/editor/use-offline-pages', () => ({ useOfflinePageList: () => mockList }));
jest.mock('@/components/ui/confirmation-dialog', () => ({ ConfirmationDialog: () => null }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    locale: 'en-US',
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join('|')}` : key,
  }),
}));

const entry = (pageId: string, over: Partial<OfflineEntry> = {}): OfflineEntry => ({
  pageId,
  reasons: ['recent'],
  openedAt: 1,
  savedAt: null,
  bytes: 2048,
  title: pageId,
  workspaceId: 'w',
  ...over,
});
let renderer: ReactTestRenderer | undefined;
const mount = () =>
  act(() => {
    renderer = create(<OfflineSection />);
  });
const root = () => (renderer as ReactTestRenderer).root;
const text = () => JSON.stringify(renderer?.toJSON());
const button = (label: string) => {
  const found = root()
    .findAllByType(Button)
    .find((b) => b.props.accessibilityLabel === label);
  if (!found) throw new Error(`no button ${label}`);
  return found;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockList = { supported: true, pages: [] };
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

it('reads sizes the way people do', () => {
  expect(formatSize(512, 'en-US')).toBe('512 B');
  expect(formatSize(2048, 'en-US')).toBe('2 KB');
  expect(formatSize(3.4 * 1024 * 1024, 'en-US')).toBe('3.4 MB');
  expect(formatSize(15 * 1024 * 1024, 'en-US')).toBe('15 MB');
});

it('lists the pages kept, why, their size and the total', () => {
  mockList.pages = [
    entry('Plan', { reasons: ['pinned', 'recent'], bytes: 3 * 1024 }),
    entry('Notes', { bytes: 1024 }),
  ];
  mount();
  expect(text()).toContain('settings.offline.total:2|4 KB');
  expect(text()).toContain('settings.offline.pinned · 3 KB · settings.offline.notSaved');
  expect(text()).toContain('settings.offline.recent · 1 KB');
  // Only a page kept by choice can be let go; a recent one stays as long as it is recent.
  expect(() => button('settings.offline.remove:Notes')).toThrow();
  act(() => button('settings.offline.remove:Plan').props.onPress());
  expect(mockStore.setPinned).toHaveBeenCalledWith('Plan', false);
});

it('opens a kept page', () => {
  mockList.pages = [entry('Plan')];
  mount();
  const link = root().findAll(
    (node) => node.props.accessibilityLabel === 'settings.offline.open:Plan' && node.props.onPress,
  )[0];
  act(() => link?.props.onPress());
  expect(mockPush).toHaveBeenCalledWith('/p/Plan');
});

it('removes every page only after confirming', () => {
  mockList.pages = [entry('Plan')];
  mount();
  const dialog = () => root().findByType(ConfirmationDialog);
  expect(dialog().props.open).toBe(false);
  act(() => button('settings.offline.removeAll').props.onPress());
  expect(dialog().props.open).toBe(true);
  expect(mockStore.clear).not.toHaveBeenCalled();
  act(() => void dialog().props.onConfirm());
  expect(mockStore.clear).toHaveBeenCalled();
});

it('says where pages are kept when this device keeps none', () => {
  mockList = { supported: false, pages: [] };
  mount();
  expect(text()).toContain('settings.offline.webOnly');
});
