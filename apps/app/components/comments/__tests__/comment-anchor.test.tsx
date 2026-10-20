import { documentFromSnapshot, EditorStore } from '@oxy.so/bloom-editor/model';
import { NILO_SCHEMA } from '@oxy.so/nilo-contracts/editor';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { CommentQuote } from '../comment-quote';
import { CommentPanel } from '../comment-panel';

let mockEditor: { store: EditorStore; controller: { refocus: jest.Mock } } | null = null;
jest.mock('@/components/page-editor/page-editor-context', () => ({
  useOptionalPageEditorContext: () => mockEditor,
}));
const mockCreate = jest.fn(async () => ({}));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ user: null }) }));
jest.mock('@/lib/hooks/use-comments', () => ({
  groupIntoThreads: () => [],
  usePageComments: () => ({ data: { comments: [] }, isLoading: false }),
  useCreateComment: () => ({ mutateAsync: mockCreate, isPending: false }),
}));
jest.mock('@/lib/realtime/use-live-updates', () => ({ useCommentsLive: () => {} }));
// The composer is its own component; here, what it submits.
jest.mock('../comment-composer', () => ({
  CommentComposer: () => null,
}));

let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer.unmount()));

const storeWith = (text: string) =>
  new EditorStore({
    document: documentFromSnapshot(
      [{ type: 'paragraph', text: [{ text }] }],
      () => 'p1',
      NILO_SCHEMA,
    ),
    schema: NILO_SCHEMA,
    newId: () => 'n',
  });
const setText = (store: EditorStore, text: string) =>
  act(() => {
    store.run(() => ({
      ops: [
        {
          kind: 'update',
          id: 'p1',
          before: { text: store.doc.blocks.p1?.text },
          after: { text: [{ text }] },
        },
      ],
    }));
  });
const strings = () =>
  renderer.root
    .findAll((node) => typeof node.type === 'string')
    .flatMap((node) => (typeof node.props.children === 'string' ? [node.props.children] : []));

describe('the text a comment is on', () => {
  const anchor = { start: 6, end: 11, quote: 'world' };

  it('is found again where edits moved it, and selected in the page when pressed', () => {
    const store = storeWith('Hello world');
    mockEditor = { store, controller: { refocus: jest.fn() } };
    act(() => {
      renderer = create(
        <BloomTestProviders>
          <CommentQuote blockId="p1" anchor={anchor} />
        </BloomTestProviders>,
      );
    });
    expect(strings()).toContain('world');
    expect(strings()).not.toContain('comments.thread.textChanged');
    setText(store, 'Oh, hello world');
    const pressable = renderer.root.findAll(
      (node) => node.props.accessibilityLabel === 'comments.thread.showText',
    )[0];
    act(() => pressable?.props.onPress());
    expect(store.selection).toEqual({ kind: 'text', blockId: 'p1', start: 10, end: 15 });
    expect(mockEditor.controller.refocus).toHaveBeenCalled();
  });

  it('says the original text changed once it is gone, or its block is', () => {
    const store = storeWith('Hello world');
    mockEditor = { store, controller: { refocus: jest.fn() } };
    act(() => {
      renderer = create(
        <BloomTestProviders>
          <CommentQuote blockId="p1" anchor={anchor} />
        </BloomTestProviders>,
      );
    });
    setText(store, 'Hello there');
    expect(strings()).toContain('comments.thread.textChanged');
    act(() =>
      renderer.update(
        <BloomTestProviders>
          <CommentQuote blockId={null} anchor={anchor} />
        </BloomTestProviders>,
      ),
    );
    expect(strings()).toContain('comments.thread.textChanged');
  });
});

describe('commenting on selected text', () => {
  it('shows the quote over the composer and sends it with the comment', async () => {
    mockEditor = { store: storeWith('Hello world'), controller: { refocus: jest.fn() } };
    const used = jest.fn();
    act(() => {
      renderer = create(
        <BloomTestProviders>
          <CommentPanel
            pageId="page"
            workspaceId="ws"
            open
            onClose={jest.fn()}
            focusedBlockId="p1"
            anchor={{ start: 6, end: 11, quote: 'world' }}
            onAnchorUsed={used}
          />
        </BloomTestProviders>,
      );
    });
    expect(strings()).toContain('world');
    const composer = renderer.root.findByType(
      jest.requireMock('../comment-composer').CommentComposer,
    );
    expect(composer.props.placeholder).toBe('comments.panel.textPlaceholder');
    await act(async () => composer.props.onSubmit([{ text: 'Which one?' }]));
    expect(mockCreate).toHaveBeenCalledWith({
      pageId: 'page',
      blockId: 'p1',
      parentCommentId: null,
      anchor: { start: 6, end: 11, quote: 'world' },
      content: { segments: [{ text: 'Which one?' }] },
    });
    expect(used).toHaveBeenCalled();
  });
});
