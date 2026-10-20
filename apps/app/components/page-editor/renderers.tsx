import type { BlockRenderer, BlockRendererProps, EditorStore } from '@oxy.so/bloom-editor';
import { type ComponentType, useSyncExternalStore } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { RiListUnordered } from '@oxy.so/bloom/icons/RiListUnordered';
import { AudioBlock } from '@/components/editor/blocks/audio-block';
import { BookmarkBlock } from '@/components/editor/blocks/bookmark-block';
import { BreadcrumbBlock } from '@/components/editor/blocks/breadcrumb-block';
import { ButtonBlock } from '@/components/editor/blocks/button-block';
import { ChildPageBlock } from '@/components/editor/blocks/child-page-block';
import { BlockCommentMarker } from '@/components/comments/comment-indicator';
import { ColumnBlock } from '@/components/editor/blocks/column-block';
import { ColumnsBlock } from '@/components/editor/blocks/columns-block';
import { EmbedBlock } from '@/components/editor/blocks/embed-block';
import { EquationBlock } from '@/components/editor/blocks/equation-block';
import { FileBlock } from '@/components/editor/blocks/file-block';
import { InlineDatabaseBlock } from '@/components/editor/blocks/inline-database-block';
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
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { contentOf, fieldsFromContent } from '@oxy.so/nilo-contracts/editor';
import type { Block, BlockType } from '@/lib/types/pages';
import { pageBlockDomId } from '@/lib/editor/dom-ids';
import { useColorScheme } from '@/lib/useColorScheme';

/**
 * Wrap one of Nilo's block components (written against the API's block
 * shape) as an editor renderer: it sees the block as the API stores it, and
 * its content edits become one undoable props change.
 */
function adapt(
  Component: ComponentType<BlockComponentProps>,
  pageId: string,
  store: EditorStore,
): BlockRenderer {
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
      <>
        <Component
          block={apiBlock}
          readOnly={readOnly}
          onChangeContent={(next) => updateProps(fieldsFromContent(block.type, next).props)}
          renderChildren={() => renderChildren()}
          store={store}
        />
        <BlockCommentMarker blockId={block.id} />
      </>
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
        <RiListUnordered width={14} height={14} fill={colors.mutedForeground} />
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
                .getElementById(pageBlockDomId(heading.id))
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

/**
 * A canvas note seen in a document (while the page is being turned back into
 * one, or by someone whose screen has not followed yet): its blocks, framed.
 */
function NoteInDocument({ renderChildren }: BlockRendererProps) {
  return <View className="my-1 rounded-xl border border-border px-3 py-1">{renderChildren()}</View>;
}

/**
 * Every block type Nilo draws itself, keyed by type. Code blocks are Bloom's:
 * it draws them highlighted (`highlightCode`, `editor-extras.ts`) and offers
 * their language (`codeLanguages`).
 */
export function createRenderers(pageId: string, store: EditorStore): Record<string, BlockRenderer> {
  const own = (Component: ComponentType<BlockComponentProps>) => adapt(Component, pageId, store);
  return {
    inline_database: own(InlineDatabaseBlock),
    image: own(ImageBlock),
    video: own(VideoBlock),
    audio: own(AudioBlock),
    file: own(FileBlock),
    pdf: own(PdfBlock),
    bookmark: own(BookmarkBlock),
    embed: own(EmbedBlock),
    columns: own(ColumnsBlock),
    canvas_note: NoteInDocument,
    column: own(ColumnBlock),
    table: own(TableBlock),
    table_row: own(TableRow),
    button: own(ButtonBlock),
    link_to_page: own(LinkToPageBlock),
    child_page: own(ChildPageBlock),
    sync_block: own(SyncBlock),
    breadcrumb: own(BreadcrumbBlock),
    equation: own(EquationBlock),
    mermaid: own(MermaidBlock),
    table_of_contents: () => <TableOfContents store={store} />,
  };
}

/** A callout's icon, which an editor presses to choose another. */
function CalloutMarker({ value, onPress }: { value: unknown; onPress?: () => void }) {
  const { t } = useTranslation();
  if (!onPress) return <CalloutIcon value={value} />;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('editor.blocks.callout.changeIcon')}
      onPress={onPress}
      className="rounded hover:bg-muted active:bg-muted"
    >
      <CalloutIcon value={value} />
    </Pressable>
  );
}

/**
 * Markers Nilo draws beside text blocks: a callout's icon (an editor presses
 * it to pick another).
 */
export function createMarkers({
  onPickCalloutIcon,
}: {
  /** Open the icon picker for a callout; without it a callout's icon is only shown. */
  onPickCalloutIcon?: (blockId: string) => void;
} = {}): Record<string, BlockRenderer> {
  return {
    callout: ({ block, readOnly }) => (
      <CalloutMarker
        value={block.props.icon}
        onPress={readOnly || !onPickCalloutIcon ? undefined : () => onPickCalloutIcon(block.id)}
      />
    ),
  };
}
