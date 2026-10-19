import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useOpenEditorMention } from '../open-target';
const mockPush = jest.fn();
const mockRouter = { push: mockPush };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
let open: ReturnType<typeof useOpenEditorMention>;
function Hook({ onOpenUser }: { onOpenUser?: (id: string) => void }) {
  open = useOpenEditorMention(onOpenUser);
  return null;
}
beforeEach(() => mockPush.mockClear());
it('does nothing when a date mention is pressed, while page mentions still open pages', () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Hook />);
  });
  act(() => open({ indicator: '@', attributes: { kind: 'date', date: '2026-10-17' } }));
  expect(mockPush).not.toHaveBeenCalled();
  act(() => open({ indicator: '@', attributes: { kind: 'page', id: 'target' } }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/(app)/p/[pageId]',
    params: { pageId: 'target' },
  });
  act(() => renderer.unmount());
});
it("shows a person's card for their mention, with the screen's latest callback", () => {
  const first = jest.fn();
  const latest = jest.fn();
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Hook onOpenUser={first} />);
  });
  const before = open;
  act(() => renderer.update(<Hook onOpenUser={latest} />));
  // The callback stays the same, so the editor's context is not rebuilt.
  expect(open).toBe(before);
  act(() => open({ indicator: '@', attributes: { kind: 'user', id: 'ana' } }));
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledWith('ana');
  expect(mockPush).not.toHaveBeenCalled();
  // Without one, a person's mention goes nowhere.
  act(() => renderer.update(<Hook />));
  act(() => open({ indicator: '@', attributes: { kind: 'user', id: 'ana' } }));
  expect(latest).toHaveBeenCalledTimes(1);
  act(() => renderer.unmount());
});
