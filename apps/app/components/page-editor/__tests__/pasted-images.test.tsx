import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { documentFromSnapshot, EditorStore, getBlock } from '@oxy.so/bloom-editor/model';
import { NILO_SCHEMA } from '@oxy.so/nilo-contracts/editor';
import { toast } from '@oxy.so/bloom/toast';
import { useEditorExtras } from '../editor-extras';

jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ oxyServices: {} }) }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));
jest.mock('@oxy.so/bloom/code', () => ({
  useCodePalette: () => ({}),
  tokenColor: () => 'black',
}));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const mockUpload = jest.fn();
jest.mock('@/lib/files/upload-page-file', () => ({
  uploadPageFile: (...args: unknown[]) => mockUpload(...args),
}));

let renderer: ReactTestRenderer | undefined;
let extras: ReturnType<typeof useEditorExtras>;
let store: EditorStore;
let resolveUpload: (value: { fileId: string }) => void;
function Harness({ pageId = 'page', readOnly = false }) {
  extras = useEditorExtras(pageId, store, readOnly);
  return null;
}
beforeEach(() => {
  let id = 0;
  const newId = () => `b${++id}`;
  store = new EditorStore({
    newId,
    schema: NILO_SCHEMA,
    document: documentFromSnapshot([{ type: 'paragraph' }], newId, NILO_SCHEMA),
  });
  mockUpload.mockReset().mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
  );
  act(() => {
    renderer = create(<Harness />);
  });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

it.each(['unsupported-cut', 'write-failed', 'changed-cut'] as const)(
  'reports clipboard %s without announcing success or modifying the document',
  (reason) => {
    jest.mocked(toast.error).mockClear();
    jest.mocked(toast.success).mockClear();
    const before = store.doc;
    act(() => extras.onClipboardError(reason));
    expect(toast.error).toHaveBeenCalledWith(
      reason === 'unsupported-cut'
        ? 'editor.clipboard.cutUnsupported'
        : reason === 'changed-cut'
          ? 'editor.clipboard.cutChanged'
          : 'editor.clipboard.writeFailed',
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(store.doc).toBe(before);
  },
);
async function paste() {
  await act(async () => {
    extras.onPasteImages(
      [{ uri: 'file:///temporary-image.png', type: 'image/png', width: 640, height: 480 }],
      store.doc.root[0] as string,
    );
  });
  expect(mockUpload).toHaveBeenCalledTimes(1);
}

it('inserts an uploaded image after the pasted block, in a single undoable transaction', async () => {
  const before = store.doc.root.slice();
  await paste();
  await act(async () => resolveUpload({ fileId: 'uploaded-file' }));
  expect(store.doc.root).toHaveLength(2);
  expect(getBlock(store.doc, store.doc.root[1] as string).props.fileId).toBe('uploaded-file');
  store.undo();
  expect(store.doc.root).toEqual(before);
});

it.each(['page', 'permissions', 'store', 'unmount'] as const)(
  'does not insert a stale upload after %s changes',
  async (change) => {
    const original = store;
    const before = original.doc;
    await paste();
    act(() => {
      if (change === 'unmount') {
        renderer?.unmount();
        renderer = undefined;
      } else {
        if (change === 'store') {
          store = new EditorStore({
            newId: () => 'other',
            schema: NILO_SCHEMA,
            document: documentFromSnapshot([], () => 'other', NILO_SCHEMA),
          });
        }
        renderer?.update(
          <Harness
            pageId={change === 'page' ? 'other-page' : 'page'}
            readOnly={change === 'permissions'}
          />,
        );
      }
    });
    await act(async () => resolveUpload({ fileId: 'uploaded-file' }));
    expect(original.doc).toBe(before);
    if (change === 'store') expect(store.doc.root).toEqual([]);
  },
);
