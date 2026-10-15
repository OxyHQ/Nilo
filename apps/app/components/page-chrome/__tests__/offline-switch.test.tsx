import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Switch } from '@/components/ui/switch';
import type { Page } from '@/lib/types/pages';
import { OfflineSwitch } from '../offline-switch';

const mockSetPinned = jest.fn(async () => undefined);
let mockOffline = { supported: true, pinned: false, setPinned: mockSetPinned };
const mockUseOfflinePage = jest.fn((..._args: unknown[]) => mockOffline);
jest.mock('@/lib/editor/use-offline-pages', () => ({
  useOfflinePage: (...args: unknown[]) => mockUseOfflinePage(...args),
}));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const page = { id: 'p', title: 'Plan', workspaceId: 'w' } as Page;
let renderer: ReactTestRenderer;
const mount = () =>
  act(() => {
    renderer = create(<OfflineSwitch page={page} />);
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockOffline = { supported: true, pinned: false, setPinned: mockSetPinned };
});
afterEach(() => act(() => renderer.unmount()));

it('keeps the page offline when switched on, naming it for the list', () => {
  mount();
  expect(mockUseOfflinePage).toHaveBeenCalledWith('p', { title: 'Plan', workspaceId: 'w' });
  const toggle = renderer.root.findByType(Switch);
  expect(toggle.props.value).toBe(false);
  act(() => toggle.props.onValueChange(true));
  expect(mockSetPinned).toHaveBeenCalledWith(true);
});

it('shows a page kept offline as on, and lets it go', () => {
  mockOffline = { ...mockOffline, pinned: true };
  mount();
  const toggle = renderer.root.findByType(Switch);
  expect(toggle.props.value).toBe(true);
  act(() => toggle.props.onValueChange(false));
  expect(mockSetPinned).toHaveBeenCalledWith(false);
});

it('is not offered where nothing is kept (a browser)', () => {
  mockOffline = { ...mockOffline, supported: false };
  mount();
  expect(renderer.toJSON()).toBeNull();
});
