import {
  documentFromSnapshot,
  EditorStore,
  editText,
  getBlock,
  removeBlocks,
} from '@oxy.so/bloom-editor/model';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { NILO_SCHEMA } from '@oxy.so/nilo-contracts/editor';
import { AiDialog, type AiTarget } from '../ai-dialog';

type Run = {
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  data?: string;
  error?: unknown;
  mutate: jest.Mock;
  reset: jest.Mock;
};
let mockRun: Run;
jest.mock('@/lib/ai/use-ai', () => ({
  ...jest.requireActual('@/lib/ai/use-ai'),
  useAiAction: () => mockRun,
}));
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({ isAuthenticated: true, oxyServices: {} }),
}));
// The dialog's body renders in place; closing it settles at once and reports
// through `onClose`, as Bloom's does once its exit has run.
jest.mock('@oxy.so/bloom/dialog', () => {
  const { useImperativeHandle } = require('react');
  const { View } = require('react-native');
  return {
    ...jest.requireActual('@oxy.so/bloom/dialog'),
    Dialog: ({
      control,
      onClose,
      children,
    }: {
      control?: { ref: unknown };
      onClose?: () => void;
      children?: React.ReactNode;
    }) => {
      useImperativeHandle(control?.ref as never, () => ({
        open: () => {},
        close: (cb?: () => void) => {
          cb?.();
          onClose?.();
        },
      }));
      return <View>{children}</View>;
    },
  };
});
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { id?: string }) => (params?.id ? `${key}:${params.id}` : key),
  }),
}));

let n = 0;
const newId = () => `b${++n}`;
let store: EditorStore;
let renderer: ReactTestRenderer;
const onClose = jest.fn();
const idle = (): Run => ({
  isPending: false,
  isSuccess: false,
  isError: false,
  mutate: jest.fn(),
  reset: jest.fn(),
});
const mount = (target: AiTarget, canvas = false) =>
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <AiDialog store={store} target={target} canvas={canvas} onClose={onClose} />
      </BloomTestProviders>,
    );
  });
const rerender = (target: AiTarget) =>
  act(() =>
    renderer.update(
      <BloomTestProviders>
        <AiDialog store={store} target={target} onClose={onClose} />
      </BloomTestProviders>,
    ),
  );
const text = () => JSON.stringify(renderer.toJSON());
const press = (label: string) => {
  const button = renderer.root.findAll(
    (node) =>
      typeof node.props.onPress === 'function' &&
      node.findAll((child) => child.props.children === label).length > 0,
    { deep: true },
  )[0];
  if (!button) throw new Error(`no ${label}`);
  act(() => button.props.onPress());
};
const outline = () =>
  store.doc.root.map((id) => {
    const b = getBlock(store.doc, id);
    return `${b.type}:${(b.text ?? []).map((s) => s.text).join('')}`;
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockRun = idle();
  store = new EditorStore({
    newId,
    schema: NILO_SCHEMA,
    document: documentFromSnapshot(
      [
        { type: 'paragraph', text: [{ text: 'teh first' }] },
        { type: 'paragraph', text: [{ text: 'second' }] },
      ],
      newId,
      NILO_SCHEMA,
    ),
  });
});
afterEach(() => act(() => renderer.unmount()));

it('runs the chosen action on the block, then replaces it with the result in one step', () => {
  const block = { kind: 'block' as const, blockId: store.doc.root[0] as string };
  mount(block);
  press('ai.actions.fixSpelling');
  expect(mockRun.mutate).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'fixSpelling', text: expect.stringContaining('teh first') }),
  );
  mockRun = { ...idle(), isSuccess: true, data: 'The **first**' };
  rerender(block);
  expect(text()).toContain('The **first**');
  const id = store.doc.root[0];
  press('ai.replace');
  expect(outline()).toEqual(['paragraph:The first', 'paragraph:second']);
  // The same block, edited in place.
  expect(store.doc.root[0]).toBe(id);
  expect(onClose).toHaveBeenCalled();
  store.undo();
  expect(outline()).toEqual(['paragraph:teh first', 'paragraph:second']);
});

it("sends a block's own text, not what it holds, and never offers to replace what Markdown would lose", () => {
  store = new EditorStore({
    newId,
    schema: NILO_SCHEMA,
    document: documentFromSnapshot(
      [
        {
          type: 'toggle',
          text: [{ text: 'Plan' }],
          children: [{ type: 'image', props: { url: 'https://img.example/a.png' } }],
        },
      ],
      newId,
      NILO_SCHEMA,
    ),
  });
  const block = { kind: 'block' as const, blockId: store.doc.root[0] as string };
  mount(block);
  press('ai.actions.improve');
  expect(mockRun.mutate.mock.calls[0]?.[0].text).toBe('Plan');
  mockRun = { ...idle(), isSuccess: true, data: 'Better plan' };
  rerender(block);
  expect(text()).not.toContain('"ai.replace"');
  expect(text()).toContain('ai.notice.insertOnly');
  press('ai.insertBelow');
  expect(store.doc.root.map((id) => getBlock(store.doc, id).type)).toEqual(['toggle', 'paragraph']);
  expect(getBlock(store.doc, store.doc.root[0] as string).children).toHaveLength(1);
});

it('overwrites nothing written in the block meanwhile, and says so', () => {
  const id = store.doc.root[0] as string;
  const block = { kind: 'block' as const, blockId: id };
  mount(block);
  press('ai.actions.shorter');
  // Someone writes in the block while the action runs.
  act(() => {
    store.run((c) => editText(c, id, [{ text: 'teh first, and more' }]));
  });
  mockRun = { ...idle(), isSuccess: true, data: 'First' };
  rerender(block);
  press('ai.replace');
  expect(outline()[0]).toBe('paragraph:teh first, and more');
  expect(onClose).not.toHaveBeenCalled();
  expect(text()).toContain('ai.notice.blockChanged');
});

it('says when the block is gone instead of losing the result silently', () => {
  const id = store.doc.root[0] as string;
  const block = { kind: 'block' as const, blockId: id };
  mockRun = { ...idle(), isSuccess: true, data: 'Extra' };
  mount(block);
  act(() => {
    store.run((c) => removeBlocks(c, [id]));
  });
  press('ai.insertBelow');
  expect(onClose).not.toHaveBeenCalled();
  expect(text()).toContain('ai.notice.blockGone');
});

it('inserts below instead, keeping the block', () => {
  const block = { kind: 'block' as const, blockId: store.doc.root[0] as string };
  mockRun = { ...idle(), isSuccess: true, data: 'Extra' };
  mount(block);
  press('ai.insertBelow');
  expect(outline()).toEqual(['paragraph:teh first', 'paragraph:Extra', 'paragraph:second']);
});

it('summarizes the whole page, and puts the summary at the top', () => {
  mount({ kind: 'page' });
  expect(text()).not.toContain('ai.actions.improve');
  press('ai.actions.summarize');
  const sent = mockRun.mutate.mock.calls[0]?.[0];
  expect(sent.text).toContain('teh first');
  expect(sent.text).toContain('second');
  mockRun = { ...idle(), isSuccess: true, data: '- gist' };
  rerender({ kind: 'page' });
  press('ai.insertTop');
  expect(outline()[0]).toBe('bulleted_list_item:gist');
});

it("puts a canvas page's summary in a note, where the canvas shows it", () => {
  mockRun = { ...idle(), isSuccess: true, data: '- gist' };
  mount({ kind: 'page' }, true);
  press('ai.insertTop');
  const note = store.doc.root[store.doc.root.length - 1] as string;
  expect(getBlock(store.doc, note).type).toBe('canvas_note');
  expect(getBlock(store.doc, getBlock(store.doc, note).children[0] as string).type).toBe(
    'bulleted_list_item',
  );
});

it('asks which language to translate into', () => {
  mount({ kind: 'block', blockId: store.doc.root[1] as string });
  press('ai.actions.translate');
  expect(mockRun.mutate).not.toHaveBeenCalled();
  press('ai.back');
  expect(text()).toContain('ai.actions.improve');
  press('ai.actions.translate');
  press('ai.languages.fr');
  expect(mockRun.mutate).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'translate', language: 'fr' }),
  );
});

it('says what went wrong, with the request to report, and lets the member try again', () => {
  const { OxyInferenceError } = jest.requireActual('@oxy.so/core/inference');
  mockRun = {
    ...idle(),
    isError: true,
    error: new OxyInferenceError({
      code: 'provider_overloaded',
      message: 'busy',
      retryable: true,
      requestId: 'req-9',
      status: 503,
    }),
  };
  mount({ kind: 'block', blockId: store.doc.root[0] as string });
  expect(text()).toContain('ai.failure.tryLater');
  expect(text()).toContain('ai.requestId:req-9');
  expect(text()).toContain('ai.actions.improve');
});
