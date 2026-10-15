import type { BlockRenderer, BlockRendererProps, EditorStore } from '@oxy.so/bloom-editor';
import { type ComponentType, useSyncExternalStore } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { List as ListIcon } from 'lucide-react-native';
import { AudioBlock } from '@/components/editor/blocks/audio-block';
import { BookmarkBlock } from '@/components/editor/blocks/bookmark-block';
import { BreadcrumbBlock } from '@/components/editor/blocks/breadcrumb-block';
import { ButtonBlock } from '@/components/editor/blocks/button-block';
import { ColumnBlock } from '@/components/editor/blocks/column-block';
import { ColumnsBlock } from '@/components/editor/blocks/columns-block';
import { EmbedBlock } from '@/components/editor/blocks/embed-block';
import { EquationBlock } from '@/components/editor/blocks/equation-block';
import { FileBlock } from '@/components/editor/blocks/file-block';
import { ImageBlock } from '@/components/editor/blocks/image-block';
import { LinkToPageBlock } from '@/components/editor/blocks/link-to-page-block';
import { MermaidBlock } from '@/components/editor/blocks/mermaid-block';
import { PdfBlock } from '@/components/editor/blocks/pdf-block';
import { SyncBlock } from '@/components/editor/blocks/sync-block';
import { TableBlock } from '@/components/editor/blocks/table-block';
import { TableRow } from '@/components/editor/blocks/table-row';
import type { BlockComponentProps } from '@/components/editor/blocks/types';
import { VideoBlock } from '@/components/editor/blocks/video-block';
import { CalloutIcon } from '@/components/page-chrome/callout-icon';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import { contentOf, fieldsFromContent } from '@/lib/editor/wire';
import type { Block, BlockType } from '@/lib/types/pages';
import { useColorScheme } from '@/lib/useColorScheme';

/**
 * Wrap one of Nilo's block components (written against the API's block
 * shape) as an editor renderer: it sees the block as the API stores it, and
 * its content edits become one undoable props change.
 */
function adapt(Component: ComponentType<BlockComponentProps>, pageId: string): BlockRenderer {
  return function Renderer({ block, readOnly, updateProps, renderChildren }: BlockRendererProps) {
    const apiBlock: Block = {
      id: block.id,
      pageId,
      parentBlockId: block.parent,
      type: block.type as BlockType,
      content: contentOf(block),
      order: 0,
      createdAt: '',
      updatedAt: '',
    };
    return (
      <Component
        block={apiBlock}
        readOnly={readOnly}
        onChangeContent={(next) => updateProps(fieldsFromContent(block.type, next).props)}
        renderChildren={() => renderChildren()}
      />
    );
  };
}

/** Headings, read live from the document; pressing one scrolls to it on web. */
function TableOfContents({ store }: { store: EditorStore }) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const doc = useSyncExternalStore(store.subscribe, () => store.getSnapshot().doc);
  const headings: { id: string; text: string; depth: number }[] = [];
  const visit = (ids: readonly string[]) => {
    for (const id of ids) {
      const block = doc.blocks[id];
      if (!block) continue;
      const depth =
        block.type === 'heading_1'
          ? 1
          : block.type === 'heading_2'
            ? 2
            : block.type === 'heading_3'
              ? 3
              : 0;
      const text = (block.text ?? [])
        .map((segment) => segment.text)
        .join('')
        .trim();
      if (depth > 0 && text) headings.push({ id, text, depth });
      visit(block.children);
    }
  };
  visit(doc.root);

  if (headings.length === 0) {
    return (
      <View className="my-1 flex-row items-center gap-2 rounded-md border border-dashed border-border px-3 py-2">
        <ListIcon size={14} color={colors.mutedForeground} />
        <Text className="text-xs text-muted-foreground">{t('editor.tableOfContents.empty')}</Text>
      </View>
    );
  }
  return (
    <View className="my-1 gap-1">
      {headings.map((heading) => (
        <Pressable
          key={heading.id}
          accessibilityRole="link"
          onPress={() => {
            if (Platform.OS === 'web') {
              document
                .getElementById(`bloom-block-${heading.id}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            store.setSelection({ kind: 'text', blockId: heading.id, start: 0, end: 0 });
          }}
          style={{ paddingLeft: (heading.depth - 1) * 16 }}
        >
          <Text className="text-sm text-muted-foreground underline">{heading.text}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Every block type Nilo draws itself, keyed by type. */
export function createRenderers(pageId: string, store: EditorStore): Record<string, BlockRenderer> {
  return {
    image: adapt(ImageBlock, pageId),
    video: adapt(VideoBlock, pageId),
    audio: adapt(AudioBlock, pageId),
    file: adapt(FileBlock, pageId),
    pdf: adapt(PdfBlock, pageId),
    bookmark: adapt(BookmarkBlock, pageId),
    embed: adapt(EmbedBlock, pageId),
    columns: adapt(ColumnsBlock, pageId),
    column: adapt(ColumnBlock, pageId),
    table: adapt(TableBlock, pageId),
    table_row: adapt(TableRow, pageId),
    button: adapt(ButtonBlock, pageId),
    link_to_page: adapt(LinkToPageBlock, pageId),
    sync_block: adapt(SyncBlock, pageId),
    breadcrumb: adapt(BreadcrumbBlock, pageId),
    equation: adapt(EquationBlock, pageId),
    mermaid: adapt(MermaidBlock, pageId),
    table_of_contents: () => <TableOfContents store={store} />,
  };
}

/** Markers Nilo draws beside text blocks. */
export function createMarkers(): Record<string, BlockRenderer> {
  return { callout: ({ block }) => <CalloutIcon value={block.props.icon} /> };
}
