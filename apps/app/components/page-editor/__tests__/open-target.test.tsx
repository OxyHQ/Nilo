import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useOpenEditorMention } from '../open-target';
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
let open: ReturnType<typeof useOpenEditorMention>;
function Hook() {
  open = useOpenEditorMention();
  return null;
}
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
