import { documentFromSnapshot, EditorStore, getBlock } from '@oxy.so/bloom-editor/model';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Switch } from '@oxy.so/bloom/switch';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { NOTE } from '@/lib/editor/canvas';
import { NILO_SCHEMA } from '@/lib/editor/schema';
import type { Page } from '@/lib/types/pages';
import { CanvasSwitch } from '../canvas-switch';

let mockStore: EditorStore | null = null;
const mockMutate = jest.fn();
const mockToastError = jest.fn();
jest.mock('@/components/page-editor/page-editor-context', () => ({
  usePageEditorContext: () => ({ store: mockStore }),
}));
jest.mock('@/lib/hooks/use-pages', () => ({
  useUpdatePage: () => ({ mutate: mockMutate, isPending: false }),
}));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { error: (m: string) => mockToastError(m) } }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let n = 0;
const newId = () => `b${++n}`;
const page = (mode: Page['mode']) => ({ id: 'p', mode, locked: false }) as Page;
let renderer: ReactTestRenderer;
const toggle = (value: boolean) =>
  act(() => renderer.root.findByType(Switch).props.onCheckedChange(value));

beforeEach(() => {
  jest.clearAllMocks();
  mockStore = new EditorStore({
    newId,
    schema: NILO_SCHEMA,
    document: documentFromSnapshot(
      [
        { type: 'paragraph', text: [{ text: 'a' }] },
        { type: 'paragraph', text: [{ text: 'b' }] },
      ],
      newId,
      NILO_SCHEMA,
    ),
  });
});
afterEach(() => act(() => renderer.unmount()));

it('puts the page in a note, then saves the mode', () => {
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <CanvasSwitch page={page('document')} />
      </BloomTestProviders>,
    );
  });
  toggle(true);
  const store = mockStore as EditorStore;
  expect(store.doc.root.map((id) => getBlock(store.doc, id).type)).toEqual([NOTE]);
  expect(mockMutate).toHaveBeenCalledWith({ id: 'p', mode: 'canvas' }, expect.anything());
});

it('puts the blocks back when the mode cannot be saved', () => {
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <CanvasSwitch page={page('document')} />
      </BloomTestProviders>,
    );
  });
  toggle(true);
  act(() => mockMutate.mock.calls[0]?.[1].onError(new Error('offline')));
  const store = mockStore as EditorStore;
  expect(store.doc.root.map((id) => getBlock(store.doc, id).type)).toEqual([
    'paragraph',
    'paragraph',
  ]);
  expect(mockToastError).toHaveBeenCalledWith('pages.canvas.failed');
});

it('is not offered before the page has loaded', () => {
  mockStore = null;
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <CanvasSwitch page={page('canvas')} />
      </BloomTestProviders>,
    );
  });
  expect(renderer.root.findByType(CanvasSwitch).children).toHaveLength(0);
});
