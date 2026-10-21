import { documentFromSnapshot, EditorStore, getBlock } from '@oxy.so/bloom-editor/model';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { NOTE } from '@/lib/editor/canvas';
import { NILO_SCHEMA } from '@oxy.so/nilo-contracts/editor';
import { fitView, MAX_ZOOM, MIN_ZOOM, PageCanvas, toCanvasPoint, zoomAround } from '../page-canvas';

jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('react-native-gesture-handler', () => {
  const chain: Record<string, unknown> = {};
  const gesture = () => new Proxy(chain, { get: () => () => gesture() });
  return {
    GestureHandlerRootView: require('react-native').View,
    Gesture: { Pan: gesture, Pinch: gesture, Tap: gesture, Simultaneous: gesture },
    GestureDetector: ({ children }: { children: unknown }) => children,
  };
});
jest.mock('@oxy.so/bloom-editor', () => {
  const { View } = require('react-native');
  return {
    EditorSurface: ({ children }: { children: unknown }) => <View>{children}</View>,
    BlockList: ({ ids }: { ids: string[] }) => <View testID={`list:${ids.join(',')}`} />,
  };
});

describe('the view of a canvas', () => {
  it('reads a screen point on the canvas', () => {
    expect(toCanvasPoint({ x: 100, y: 50, scale: 2 }, { x: 300, y: 250 })).toEqual({
      x: 100,
      y: 100,
    });
  });

  it('zooms around a point, which stays where it is, within limits', () => {
    const view = { x: 0, y: 0, scale: 1 };
    const focus = { x: 200, y: 100 };
    const zoomed = zoomAround(view, 2, focus);
    expect(toCanvasPoint(zoomed, focus)).toEqual(toCanvasPoint(view, focus));
    expect(zoomAround(view, 99, focus).scale).toBe(MAX_ZOOM);
    expect(zoomAround(view, 0.01, focus).scale).toBe(MIN_ZOOM);
  });

  it('fits every note, never past 100%', () => {
    const size = { width: 1000, height: 800 };
    const small = fitView([{ x: 0, y: 0, width: 300, height: 100 }], size);
    expect(small.scale).toBe(1);
    const wide = fitView(
      [
        { x: -1000, y: 0, width: 400, height: 200 },
        { x: 2000, y: 1500, width: 400, height: 200 },
      ],
      size,
    );
    expect(wide.scale).toBeLessThan(1);
    // Both corners land inside the frame.
    for (const corner of [
      { x: -1000, y: 0 },
      { x: 2400, y: 1700 },
    ]) {
      const screen = { x: corner.x * wide.scale + wide.x, y: corner.y * wide.scale + wide.y };
      expect(screen.x).toBeGreaterThanOrEqual(0);
      expect(screen.x).toBeLessThanOrEqual(size.width);
      expect(screen.y).toBeGreaterThanOrEqual(0);
      expect(screen.y).toBeLessThanOrEqual(size.height);
    }
  });
});

let n = 0;
const newId = () => `b${++n}`;
const storeOf = (snapshot: Parameters<typeof documentFromSnapshot>[0]) =>
  new EditorStore({
    newId,
    schema: NILO_SCHEMA,
    document: documentFromSnapshot(snapshot, newId, NILO_SCHEMA),
  });
let renderer: ReactTestRenderer | undefined;
const mount = (store: EditorStore, readOnly = false) =>
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <PageCanvas store={store} readOnly={readOnly} slashItems={[]} />
      </BloomTestProviders>,
    );
  });
/** The buttons labelled `label`, once each (not their host views too). */
const buttons = (label: string) =>
  (renderer as ReactTestRenderer).root.findAll(
    (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function',
    { deep: false },
  );
const press = (label: string, index = 0) => act(() => buttons(label)[index]?.props.onPress());
afterEach(() => {
  if (renderer) act(() => renderer?.unmount());
  renderer = undefined;
});

describe('PageCanvas', () => {
  it('places each note where it sits, with its blocks', () => {
    const store = storeOf([
      { type: NOTE, props: { x: 40, y: 80, width: 300 }, children: [{ type: 'paragraph' }] },
    ]);
    mount(store);
    const note = store.doc.root[0] as string;
    const child = getBlock(store.doc, note).children[0];
    expect(
      (renderer as ReactTestRenderer).root.findByProps({ testID: `list:${child}` }),
    ).toBeTruthy();
    expect(JSON.stringify(renderer?.toJSON())).toContain('"left":40');
  });

  it('adds a note from the controls, and says how when there is none', () => {
    const store = storeOf([]);
    mount(store);
    expect(JSON.stringify(renderer?.toJSON())).toContain('editor.canvas.empty');
    press('editor.canvas.newNote');
    expect(store.doc.root.map((id) => getBlock(store.doc, id).type)).toEqual([NOTE]);
  });

  it('shows blocks outside a note without moving them, and puts them in one when asked', () => {
    const store = storeOf([{ type: 'paragraph', text: [{ text: 'loose' }] }]);
    const loose = store.doc.root[0] as string;
    const changes = jest.fn();
    store.onTransaction(changes);
    mount(store);
    // Looking at the canvas changes nothing (a collaborator switching it back
    // to a document, an undo, a reader).
    expect(changes).not.toHaveBeenCalled();
    expect(store.doc.root).toEqual([loose]);
    expect(
      (renderer as ReactTestRenderer).root.findByProps({ testID: `list:${loose}` }),
    ).toBeTruthy();
    act(() =>
      (renderer as ReactTestRenderer).root
        .findAll(
          (node) =>
            typeof node.props.onPress === 'function' &&
            node.findAll((child) => child.props.children === 'editor.canvas.putInNote').length > 0,
          { deep: false },
        )[0]
        ?.props.onPress(),
    );
    const [note] = store.doc.root;
    expect(getBlock(store.doc, note as string).type).toBe(NOTE);
    expect(getBlock(store.doc, note as string).children).toEqual([loose]);
  });

  it('shows a reader the blocks outside a note, with nothing to change them', () => {
    const store = storeOf([{ type: 'paragraph', text: [{ text: 'loose' }] }]);
    mount(store, true);
    expect(JSON.stringify(renderer?.toJSON())).toContain('editor.canvas.loose');
    expect(JSON.stringify(renderer?.toJSON())).not.toContain('editor.canvas.putInNote');
  });

  it('deletes a note, and writes in an empty one', () => {
    const store = storeOf([
      { type: NOTE, props: { x: 0, y: 0 }, children: [] },
      { type: NOTE, props: { x: 500, y: 0 }, children: [{ type: 'paragraph' }] },
    ]);
    mount(store);
    press('editor.canvas.writeInNote');
    expect(getBlock(store.doc, store.doc.root[0] as string).children).toHaveLength(1);
    expect(buttons('editor.canvas.deleteNote')).toHaveLength(2);
    press('editor.canvas.deleteNote', 1);
    expect(store.doc.root).toHaveLength(1);
  });

  it('lets a reader look around, and change nothing', () => {
    const store = storeOf([{ type: NOTE, props: { x: 0, y: 0 }, children: [] }]);
    mount(store, true);
    const labels = (renderer as ReactTestRenderer).root
      .findAll((node) => typeof node.props.accessibilityLabel === 'string')
      .map((node) => node.props.accessibilityLabel);
    expect(labels).toContain('editor.canvas.zoomIn');
    for (const editing of [
      'editor.canvas.newNote',
      'editor.canvas.deleteNote',
      'editor.canvas.writeInNote',
      'editor.canvas.resizeNote',
    ]) {
      expect(labels).not.toContain(editing);
    }
  });
});
