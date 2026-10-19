import type { Block as EditorBlock, BlockRendererProps } from '@oxy.so/bloom-editor';
import { EditorStore } from '@oxy.so/bloom-editor/model';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { NILO_SCHEMA } from '@oxy.so/nilo-contracts/editor';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { CodeLanguagePicker, CodeView } from '@/components/editor/blocks/code-view';
import { createMarkers, createRenderers } from '../renderers';

jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ oxyServices: {} }) }));
// The other blocks, which reach the API and the device's stores: not what is tested here.
jest.mock('@/components/editor/blocks/inline-database-block', () => ({
  InlineDatabaseBlock: () => null,
}));
jest.mock('@/components/editor/blocks/link-to-page-block', () => ({ LinkToPageBlock: () => null }));
jest.mock('@/components/editor/blocks/child-page-block', () => ({ ChildPageBlock: () => null }));
jest.mock('@/components/editor/blocks/breadcrumb-block', () => ({ BreadcrumbBlock: () => null }));
jest.mock('@/components/editor/blocks/button-block', () => ({ ButtonBlock: () => null }));
jest.mock('@/components/editor/blocks/sync-block', () => ({ SyncBlock: () => null }));
jest.mock('@/components/editor/blocks/image-block', () => ({ ImageBlock: () => null }));
jest.mock('@/components/editor/blocks/file-block', () => ({ FileBlock: () => null }));
jest.mock('@/components/editor/blocks/video-block', () => ({ VideoBlock: () => null }));
jest.mock('@/components/editor/blocks/audio-block', () => ({ AudioBlock: () => null }));
jest.mock('@/components/editor/blocks/pdf-block', () => ({ PdfBlock: () => null }));
jest.mock('@/components/editor/blocks/bookmark-block', () => ({ BookmarkBlock: () => null }));
jest.mock('@/components/editor/blocks/embed-block', () => ({ EmbedBlock: () => null }));
jest.mock('@/components/editor/blocks/mermaid-block', () => ({ MermaidBlock: () => null }));
jest.mock('@/components/editor/blocks/equation-block', () => ({ EquationBlock: () => null }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));
jest.mock('@/components/page-chrome/callout-icon', () => ({ CalloutIcon: () => null }));

const store = new EditorStore({
  document: { root: [], blocks: {} },
  schema: NILO_SCHEMA,
  newId: () => 'id',
});
const code: EditorBlock = {
  id: 'code',
  type: 'code',
  parent: null,
  text: [{ text: 'SELECT 1' }],
  props: { language: 'sql' },
  children: [],
};
const callout: EditorBlock = {
  id: 'callout',
  type: 'callout',
  parent: null,
  text: [],
  props: { icon: 'emoji:🔥' },
  children: [],
};
const props = (block: EditorBlock, readOnly: boolean, updateProps = jest.fn()) =>
  ({ block, readOnly, updateProps, renderChildren: () => null }) satisfies BlockRendererProps;

let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer?.unmount()));
const mount = (node: React.ReactNode) =>
  act(() => {
    renderer = create(<BloomTestProviders>{node}</BloomTestProviders>);
  });

describe('code blocks', () => {
  it("are highlighted for a reader, and an editor's are left to the editor's text block", () => {
    const reader = createRenderers('page', store, true);
    const editor = createRenderers('page', store, false);
    expect(editor.code).toBeUndefined();
    mount(reader.code?.(props(code, true)));
    const view = renderer.root.findByType(CodeView);
    expect(view.props).toMatchObject({ code: 'SELECT 1', language: 'sql' });
    expect(JSON.stringify(renderer.toJSON())).toContain('SQL');
  });

  it('offer an editor their language beside the code, and store the one picked', () => {
    const markers = createMarkers();
    expect(markers.code?.(props(code, true))).toBeNull();
    const updateProps = jest.fn();
    mount(markers.code?.(props(code, false, updateProps)));
    const picker = renderer.root.findByType(CodeLanguagePicker);
    expect(picker.props.language).toBe('sql');
    act(() => picker.props.onChange('python'));
    expect(updateProps).toHaveBeenCalledWith({ language: 'python' });
  });
});

describe('callouts', () => {
  it('open the icon picker for an editor, and only show the icon to a reader', () => {
    const onPickCalloutIcon = jest.fn();
    const markers = createMarkers({ onPickCalloutIcon });
    mount(markers.callout?.(props(callout, false)));
    const button = renderer.root.findByProps({
      accessibilityLabel: 'editor.blocks.callout.changeIcon',
    });
    act(() => button.props.onPress());
    expect(onPickCalloutIcon).toHaveBeenCalledWith('callout');

    act(() =>
      renderer.update(
        <BloomTestProviders>{markers.callout?.(props(callout, true))}</BloomTestProviders>,
      ),
    );
    expect(
      renderer.root.findAllByProps({ accessibilityLabel: 'editor.blocks.callout.changeIcon' }),
    ).toHaveLength(0);
  });
});

it('draws a child page block as Nilo does a link to a page', () => {
  expect(createRenderers('page', store).child_page).toBeDefined();
});
