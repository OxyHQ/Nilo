/**
 * Native sidebar drag and drop: a long press lifts a row, the row under the
 * finger shows where it would land, and lifting the finger drops it there.
 */
import { View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Page } from '@/lib/types/pages';
import { PageDragProvider } from '../drag-context';
import { SidebarPageRow } from '../page-row';

type Handler = (...args: unknown[]) => void;
interface MockGesture {
  handlers: Record<string, Handler>;
  enabled: boolean;
}

jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('react-native-gesture-handler', () => {
  const { View: MockView } = require('react-native');
  const pan = () => {
    const gesture: MockGesture = { handlers: {}, enabled: true };
    const chain: Record<string, unknown> = new Proxy(
      {},
      {
        get: (_target, key: string) => {
          if (key === 'mockGesture') return gesture;
          return (arg: unknown) => {
            if (key === 'enabled') gesture.enabled = Boolean(arg);
            if (typeof arg === 'function') gesture.handlers[key] = arg as Handler;
            return chain;
          };
        },
      },
    );
    return chain;
  };
  return {
    Gesture: { Pan: pan },
    GestureDetector: ({ gesture, children }: { gesture: unknown; children: unknown }) => (
      <MockView testID="detector" gesture={(gesture as { mockGesture: MockGesture }).mockGesture}>
        {children as never}
      </MockView>
    ),
  };
});
// The row's own look is `SharedPageRow`'s; here it only reports what the drag gives it.
jest.mock('../shared-page-row', () => {
  const { View: MockView } = require('react-native');
  return {
    SharedPageRow: (props: { page: { id: string }; platformDrag: unknown }) => (
      <MockView testID={`row:${props.page.id}`} platformDrag={props.platformDrag} />
    ),
  };
});

const page = (id: string) => ({ id, title: id, parentId: null }) as Page;
/** Each row 28 high, one under the other from y = 100. */
const TOP: Record<string, number> = { a: 100, b: 128, c: 156 };

let renderer: ReactTestRenderer;
const onDrop: Record<string, jest.Mock> = { a: jest.fn(), b: jest.fn(), c: jest.fn() };

async function mount(enableDrag = true) {
  await act(async () => {
    renderer = create(
      <PageDragProvider>
        {['a', 'b', 'c'].map((id) => (
          <SidebarPageRow
            key={id}
            page={page(id)}
            depth={0}
            hasChildren={false}
            isOpen={false}
            onToggle={() => undefined}
            isActive={false}
            workspaceId="w"
            enableDrag={enableDrag}
            onDrop={onDrop[id]}
          />
        ))}
      </PageDragProvider>,
    );
  });
  // React Native's jest mocks measure nothing: each row's frame is given here.
  for (const node of renderer.root.findAll(
    (n) => n.type === View && n.props.collapsable === false,
  )) {
    const id = (node.props.children as { props: { page: { id: string } } }).props.page.id;
    (node.instance as { measureInWindow: unknown }).measureInWindow = (
      cb: (x: number, y: number, w: number, h: number) => void,
    ) => cb(0, TOP[id], 240, 28);
  }
}

const gestureOf = (id: string): MockGesture => {
  const detectors = renderer.root.findAll(
    (node) => node.type === View && node.props.testID === 'detector',
  );
  const index = ['a', 'b', 'c'].indexOf(id);
  return detectors[index].props.gesture as MockGesture;
};
const dragOf = (id: string) =>
  renderer.root.findAll((node) => node.props.testID === `row:${id}`)[0].props.platformDrag as {
    isDragging: boolean;
    dropIndicator: string | null;
  } | null;

beforeEach(() => {
  for (const mock of Object.values(onDrop)) mock.mockClear();
});
afterEach(() => act(() => renderer.unmount()));

it('lifts a row on long press and drops it inside the row under the finger', async () => {
  await mount();
  const pan = gestureOf('a');
  expect(pan.enabled).toBe(true);

  await act(async () => pan.handlers.onStart({}));
  expect(dragOf('a')?.isDragging).toBe(true);

  act(() => pan.handlers.onUpdate({ translationY: 40, absoluteY: 142 }));
  expect(dragOf('b')?.dropIndicator).toBe('inside');
  expect(dragOf('c')?.dropIndicator).toBeNull();

  // Further down, onto the top of the next row: before it.
  act(() => pan.handlers.onUpdate({ translationY: 60, absoluteY: 158 }));
  expect(dragOf('b')?.dropIndicator).toBeNull();
  expect(dragOf('c')?.dropIndicator).toBe('before');

  act(() => pan.handlers.onFinalize({}, true));
  expect(onDrop.c).toHaveBeenCalledWith('a', 'before');
  expect(onDrop.b).not.toHaveBeenCalled();
  expect(dragOf('a')?.isDragging).toBe(false);
  expect(dragOf('c')?.dropIndicator).toBeNull();
});

it('drops nothing when the pan is cancelled or the finger is over the row itself', async () => {
  await mount();
  const pan = gestureOf('b');
  await act(async () => pan.handlers.onStart({}));
  act(() => pan.handlers.onUpdate({ translationY: -20, absoluteY: 110 }));
  act(() => pan.handlers.onFinalize({}, false));
  expect(Object.values(onDrop).every((mock) => mock.mock.calls.length === 0)).toBe(true);

  await act(async () => pan.handlers.onStart({}));
  act(() => pan.handlers.onUpdate({ translationY: 2, absoluteY: 140 }));
  act(() => pan.handlers.onFinalize({}, true));
  expect(Object.values(onDrop).every((mock) => mock.mock.calls.length === 0)).toBe(true);
});

it('offers no drag where the tree has none', async () => {
  await mount(false);
  expect(gestureOf('a').enabled).toBe(false);
  expect(dragOf('a')).toBeNull();
});
