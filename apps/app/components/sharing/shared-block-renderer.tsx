import { BlockText, blockTextSegments, PublicMentionContext } from './block-text';
import { blockFileId, type FileUrlScope, isEntityId, syncedSource } from '@oxy.so/nilo-contracts';
import { Button } from '@oxy.so/bloom/button';
import { router } from 'expo-router';
import { Checkbox } from '@oxy.so/bloom/checkbox';
import { Divider } from '@oxy.so/bloom/divider';
import { Text } from '@oxy.so/bloom/typography';
import { useQueryClient } from '@tanstack/react-query';
import { Platform, Pressable, type TextStyle, View } from 'react-native';
import {
  FileScopeProvider,
  freshFileUrl,
  useFileImageSource,
  useFileRemoved,
  useFileScope,
} from '@/lib/files/file-urls';
import { CalloutIcon } from '@/components/page-chrome/callout-icon';
import type { PageFont } from '@/lib/types/pages';
import { PAGE_FONT_FAMILIES } from '@/lib/fonts';
import { RiArrowRightSLine } from '@oxy.so/bloom/icons/RiArrowRightSLine';
import { RiArrowDownSLine } from '@oxy.so/bloom/icons/RiArrowDownSLine';
import { RiFileLine } from '@oxy.so/bloom/icons/RiFileLine';
import { useColorScheme } from '@/lib/useColorScheme';
import { cn } from '@/lib/utils';
import {
  buildBlockTree,
  inReadingOrder,
  type ReadOnlyBlock,
  type BlockTreeNode,
} from '@/lib/block-tree';
import { createContext, type ComponentType, useContext, useMemo, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { Block, BlockType } from '@/lib/types/pages';
import { type BlockComponentProps, blockUrl } from '@/components/editor/blocks/types';
import { AudioBlock } from '@/components/editor/blocks/audio-block';
import { BookmarkBlock } from '@/components/editor/blocks/bookmark-block';
import { EmbedBlock } from '@/components/editor/blocks/embed-block';
import { EquationBlock } from '@/components/editor/blocks/equation-block';
import { MermaidBlock } from '@/components/editor/blocks/mermaid-block';
import { PdfBlock } from '@/components/editor/blocks/pdf-block';
import { VideoBlock } from '@/components/editor/blocks/video-block';
import { CodeView } from '@/components/editor/blocks/code-view';
import { SizedImage } from '@/components/editor/blocks/image-block';
import { imageAlignment, imageWidth } from '@/components/editor/blocks/image-layout';
import { columnShares } from '@/lib/editor/columns';

/**
 * The editor's own blocks, read-only, for the kinds a shared page shows the
 * same way it is edited: one rendering of each, not a second copy here.
 */
const EDITOR_BLOCKS: Partial<Record<string, ComponentType<BlockComponentProps>>> = {
  video: VideoBlock,
  audio: AudioBlock,
  pdf: PdfBlock,
  bookmark: BookmarkBlock,
  embed: EmbedBlock,
  equation: EquationBlock,
  mermaid: MermaidBlock,
};

const ignoreChange = () => {};

function asEditorBlock(block: ReadOnlyBlock): Block {
  return {
    ...block,
    pageId: '',
    type: block.type as BlockType,
    createdAt: '',
    updatedAt: '',
  };
}

/** The page's headings, for a table of contents anywhere in it. */
const HeadingsContext = createContext<readonly ReadOnlyBlock[]>([]);

/**
 * What the page's synced blocks show, by original id (the server sends only
 * what this reader may see), and the originals being shown around a block:
 * a reference inside the original it shows draws nothing.
 */
const SyncedContext = createContext<{
  synced: Readonly<Record<string, readonly ReadOnlyBlock[]>>;
  showing: ReadonlySet<string>;
}>({ synced: {}, showing: new Set() });

/** A synced block, read: an original its own blocks, a reference its original's. */
function SyncedContent({
  block,
  childrenNodes,
  textStyle,
}: {
  block: ReadOnlyBlock;
  childrenNodes: BlockTreeNode[];
  textStyle: TextStyle;
}) {
  const { synced, showing } = useContext(SyncedContext);
  const source = syncedSource(block.type, block.content);
  const sourceId = source?.blockId ?? null;
  const shown = sourceId && !showing.has(sourceId) ? synced[sourceId] : undefined;
  const nodes = useMemo(() => (shown ? buildBlockTree(shown) : null), [shown]);
  const inner = useMemo(
    () => ({ synced, showing: new Set([...showing, ...(sourceId ? [sourceId] : [])]) }),
    [synced, showing, sourceId],
  );
  if (!sourceId) return <BlockBranch nodes={childrenNodes} textStyle={textStyle} />;
  if (!nodes) return null;
  return (
    <SyncedContext.Provider value={inner}>
      <BlockBranch nodes={nodes} textStyle={textStyle} />
    </SyncedContext.Provider>
  );
}

interface SharedBlockRendererProps {
  block: ReadOnlyBlock;
  listIndex?: number;
  /** The page's face, set on every block's text. */
  textStyle?: TextStyle;
}

/** One block's content and the page face its text is set in. */
interface BlockProps {
  content: Record<string, unknown>;
  textStyle?: TextStyle;
}

function getText(content: Record<string, unknown>): string {
  return blockTextSegments(content)
    .map((segment) => segment.text)
    .join('');
}

function getChecked(content: Record<string, unknown>): boolean {
  return content.checked === true;
}

function getLanguage(content: Record<string, unknown>): string {
  return typeof content.language === 'string' ? content.language : 'plain';
}

function ParagraphBlock({ content, textStyle }: BlockProps) {
  const { t } = useTranslation();
  const text = getText(content);
  return (
    <Text className="text-base leading-7 text-foreground" style={textStyle}>
      {text ? (
        <BlockText content={content} />
      ) : (
        <Text className="text-base leading-7 text-muted-foreground italic" style={textStyle}>
          {t('sharing.blocks.emptyParagraph')}
        </Text>
      )}
    </Text>
  );
}

function HeadingBlock({ content, level, textStyle }: BlockProps & { level: 1 | 2 | 3 }) {
  const { t } = useTranslation();
  const text = <BlockText content={content} fallback={t('sharing.blocks.untitledHeading')} />;
  const className =
    level === 1
      ? 'text-3xl font-bold text-foreground mt-4'
      : level === 2
        ? 'text-2xl font-bold text-foreground mt-3'
        : 'text-xl font-semibold text-foreground mt-2';
  return (
    <Text accessibilityRole="header" className={className} style={textStyle}>
      {text}
    </Text>
  );
}

function BulletedListBlock({ content, textStyle }: BlockProps) {
  return (
    <View className="flex-row gap-2">
      <Text className="text-base leading-7 text-foreground" style={textStyle}>
        {'•'}
      </Text>
      <Text className="text-base leading-7 text-foreground flex-1" style={textStyle}>
        <BlockText content={content} />
      </Text>
    </View>
  );
}

function NumberedListBlock({ content, index, textStyle }: BlockProps & { index: number }) {
  return (
    <View className="flex-row gap-2">
      <Text className="text-base leading-7 text-foreground" style={textStyle}>
        {`${index}.`}
      </Text>
      <Text className="text-base leading-7 text-foreground flex-1" style={textStyle}>
        <BlockText content={content} />
      </Text>
    </View>
  );
}

function TodoBlock({ content, textStyle }: BlockProps) {
  const checked = getChecked(content);
  // A published page is read, not edited: the checkmark is a presentation.
  return (
    <Checkbox
      readOnly
      checked={checked}
      labelContent={
        <Text
          className={`text-base leading-7 ${
            checked ? 'text-muted-foreground line-through' : 'text-foreground'
          }`}
          style={textStyle}
        >
          <BlockText content={content} />
        </Text>
      }
    />
  );
}

function QuoteBlock({ content, textStyle }: BlockProps) {
  return (
    <View className="border-l-2 border-border pl-4 py-1">
      <Text className="text-base leading-7 text-muted-foreground italic" style={textStyle}>
        <BlockText content={content} />
      </Text>
    </View>
  );
}

function DividerBlock() {
  return <Divider spacing={12} />;
}

function CodeBlock({ content }: BlockProps) {
  return (
    <View className="rounded-lg border border-border bg-muted/40 overflow-hidden">
      <CodeView code={getText(content)} language={getLanguage(content)} />
    </View>
  );
}

function CalloutBlock({ content, textStyle }: BlockProps) {
  return (
    <View className="flex-row gap-3 rounded-xl bg-muted/40 px-4 py-3">
      <CalloutIcon value={content.icon} size={22} />
      <Text className="text-base leading-7 text-foreground flex-1" style={textStyle}>
        <BlockText content={content} />
      </Text>
    </View>
  );
}

const stringOf = (value: unknown) => (typeof value === 'string' ? value : '');

/** An image: a pasted URL, or an attachment through a URL minted for this reader. */
function SharedImage({ content }: { content: Record<string, unknown> }) {
  const fileId = blockFileId(content);
  const { t } = useTranslation();
  const scope = useFileScope(undefined);
  const fileSource = useFileImageSource(scope, fileId);
  const removed = useFileRemoved(scope, fileId);
  const url = fileId ? (fileSource?.uri ?? null) : stringOf(content.url);
  const caption = stringOf(content.caption);
  if (!url) {
    return fileId ? (
      <View
        className="items-center justify-center rounded-lg bg-muted/40"
        style={{ width: '100%', aspectRatio: 16 / 9 }}
      >
        {removed ? (
          <Text className="text-sm text-muted-foreground">{t('sharing.blocks.fileRemoved')}</Text>
        ) : null}
      </View>
    ) : null;
  }
  return (
    <View className="gap-1">
      <SizedImage
        source={fileSource ?? { uri: url }}
        alt={stringOf(content.alt) || caption || undefined}
        width={imageWidth(content.width)}
        alignment={imageAlignment(content.alignment)}
        readOnly
      />
      {caption ? <Text className="text-xs text-muted-foreground">{caption}</Text> : null}
    </View>
  );
}

/** A file: opened through a URL that works now. */
function SharedFile({ content }: { content: Record<string, unknown> }) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const scope = useFileScope(undefined);
  const fileId = blockFileId(content);
  const url = stringOf(content.url);
  const [failed, setFailed] = useState(false);
  const removed = useFileRemoved(scope, fileId, { fetch: false });
  if (!fileId && !url) return null;
  const name = stringOf(content.name) || url.split('/').pop() || 'file';
  const open = async () => {
    setFailed(false);
    const target = fileId && scope ? await freshFileUrl(queryClient, scope, fileId) : url;
    if (!target) return setFailed(true);
    if (Platform.OS === 'web') window.open(target, '_blank', 'noopener,noreferrer');
    else await (await import('expo-web-browser')).openBrowserAsync(target);
  };
  return (
    <View className="gap-1">
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={name}
        onPress={() => void open().catch(() => setFailed(true))}
        className="flex-row items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
      >
        <RiFileLine width={18} height={18} fill={colors.foreground} />
        <Text className="flex-1 text-sm text-foreground">{name}</Text>
      </Pressable>
      {removed ? (
        <Text className="text-xs text-muted-foreground">{t('sharing.blocks.fileRemoved')}</Text>
      ) : failed ? (
        <Text className="text-xs text-destructive">{t('sharing.blocks.fileUnavailable')}</Text>
      ) : null}
    </View>
  );
}

export function SharedBlockRenderer({ block, listIndex = 1, textStyle }: SharedBlockRendererProps) {
  const { t } = useTranslation();
  const { content } = block;
  switch (block.type) {
    case 'toggle':
    case 'table_cell':
    case 'paragraph':
      return <ParagraphBlock content={content} textStyle={textStyle} />;
    case 'heading_1':
      return <HeadingBlock content={content} level={1} textStyle={textStyle} />;
    case 'heading_2':
      return <HeadingBlock content={content} level={2} textStyle={textStyle} />;
    case 'heading_3':
      return <HeadingBlock content={content} level={3} textStyle={textStyle} />;
    case 'bulleted_list_item':
      return <BulletedListBlock content={content} textStyle={textStyle} />;
    case 'numbered_list_item':
      return <NumberedListBlock content={content} index={listIndex} textStyle={textStyle} />;
    case 'todo':
      return <TodoBlock content={content} textStyle={textStyle} />;
    case 'quote':
      return <QuoteBlock content={content} textStyle={textStyle} />;
    // Laid out by `BlockNode`, which holds their children.
    case 'columns':
    case 'column':
    case 'table':
    case 'table_row':
    case 'sync_block':
      return null;
    // Where the page sits is the app's to show, not a shared page's.
    case 'breadcrumb':
      return null;
    case 'table_of_contents':
      return <TableOfContents textStyle={textStyle} />;
    // A button and a page link, as a reader who may not be signed in sees
    // them: the editor's need the workspace and an account.
    case 'button':
      return <SharedButton content={content} />;
    case 'link_to_page':
    case 'child_page':
      return <SharedPageLink content={content} textStyle={textStyle} />;
    case 'inline_database':
      return (
        <Text className="text-sm text-muted-foreground italic" style={textStyle}>
          {t('sharing.blocks.database')}
        </Text>
      );
    case 'divider':
      return <DividerBlock />;
    case 'code':
      return <CodeBlock content={content} textStyle={textStyle} />;
    case 'callout':
      return <CalloutBlock content={content} textStyle={textStyle} />;
    case 'image':
      return <SharedImage content={content} />;
    case 'file':
      return <SharedFile content={content} />;
    default: {
      const EditorBlock = EDITOR_BLOCKS[block.type];
      if (EditorBlock) {
        return <EditorBlock block={asEditorBlock(block)} onChangeContent={ignoreChange} readOnly />;
      }
      return (
        <Text className="text-sm text-muted-foreground italic" style={textStyle}>
          {t('sharing.blocks.unsupported', { type: block.type })}
        </Text>
      );
    }
  }
}

function openLink(url: string) {
  if (Platform.OS === 'web') window.open(url, '_blank', 'noopener,noreferrer');
  else void import('expo-web-browser').then((mod) => mod.openBrowserAsync(url));
}

/** A button that opens a link does so; one whose action needs an editor shows its label. */
function SharedButton({ content }: { content: Record<string, unknown> }) {
  const { t } = useTranslation();
  const url = content.action === 'navigate' ? blockUrl(content.url) : '';
  const label = stringOf(content.label) || t('editor.blocks.button.defaultLabel');
  return (
    <Button
      appearance="solid"
      tone="accent"
      size="sm"
      className="self-start"
      disabled={!url}
      onPress={() => openLink(url)}
    >
      {label}
    </Button>
  );
}

/** A link to another page: opened in the app, where its access decides. */
function SharedPageLink({
  content,
  textStyle,
}: {
  content: Record<string, unknown>;
  textStyle?: TextStyle;
}) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const pageId = stringOf(content.pageId);
  if (!isEntityId(pageId) || /^0+$/.test(pageId)) return null;
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(`/p/${pageId}`)}
      className="flex-row items-center gap-2"
    >
      <RiFileLine width={14} height={14} fill={colors.mutedForeground} />
      <Text className="text-sm text-foreground underline" style={textStyle}>
        {t('editor.blocks.linkToPage.label')}
      </Text>
    </Pressable>
  );
}

function TableOfContents({ textStyle }: { textStyle?: TextStyle }) {
  const headings = useContext(HeadingsContext);
  return (
    <View className="gap-1">
      {headings.map((heading) => (
        <Text
          key={heading.id}
          className="text-sm text-muted-foreground underline"
          style={[textStyle, { marginLeft: (Number(heading.type.slice(-1)) - 1) * 16 }]}
        >
          {getText(heading.content)}
        </Text>
      ))}
    </View>
  );
}

/** Shared nesting and sibling ordering for published pages and version previews. */
const NO_SYNCED: Readonly<Record<string, readonly ReadOnlyBlock[]>> = {};

export function SharedBlockTree({
  blocks,
  synced = NO_SYNCED,
  publicSlug,
  font = 'default',
  fileScope,
}: {
  blocks: readonly ReadOnlyBlock[];
  /** What each synced block shows, by its original's id, as the server sends it. */
  synced?: Readonly<Record<string, readonly ReadOnlyBlock[]>>;
  publicSlug?: string;
  font?: PageFont;
  /** How the reader reached these blocks, which is how their files are asked for. */
  fileScope?: FileUrlScope;
}) {
  const { t } = useTranslation();
  const textStyle = useMemo(() => ({ fontFamily: PAGE_FONT_FAMILIES[font] }), [font]);
  const tree = useMemo(() => inReadingOrder(buildBlockTree(blocks)), [blocks]);
  const syncedValue = useMemo(() => ({ synced, showing: new Set<string>() }), [synced]);
  const headings = useMemo(() => {
    const found: ReadOnlyBlock[] = [];
    const walk = (nodes: readonly BlockTreeNode[]) => {
      for (const node of nodes) {
        if (/^heading_[123]$/.test(node.block.type)) found.push(node.block);
        walk(node.children);
      }
    };
    walk(tree);
    return found;
  }, [tree]);
  if (!tree.length)
    return (
      <Text className="text-sm text-muted-foreground" style={textStyle}>
        {t('pages.share.empty')}
      </Text>
    );
  const branch = (
    <PublicMentionContext.Provider value={publicSlug}>
      <HeadingsContext.Provider value={headings}>
        <SyncedContext.Provider value={syncedValue}>
          <BlockBranch nodes={tree} textStyle={textStyle} />
        </SyncedContext.Provider>
      </HeadingsContext.Provider>
    </PublicMentionContext.Provider>
  );
  return fileScope ? <FileScopeProvider scope={fileScope}>{branch}</FileScopeProvider> : branch;
}
function BlockBranch({ nodes, textStyle }: { nodes: BlockTreeNode[]; textStyle: TextStyle }) {
  let listIndex = 0;
  return (
    <View className="gap-1.5">
      {nodes.map(({ block, children }) => {
        listIndex = block.type === 'numbered_list_item' ? listIndex + 1 : 0;
        return (
          <BlockNode
            key={block.id}
            block={block}
            listIndex={listIndex}
            childrenNodes={children}
            textStyle={textStyle}
          />
        );
      })}
    </View>
  );
}

function BlockNode({
  block,
  listIndex,
  childrenNodes,
  textStyle,
}: {
  block: ReadOnlyBlock;
  listIndex: number;
  childrenNodes: BlockTreeNode[];
  textStyle: TextStyle;
}) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const [expanded, setExpanded] = useState(block.content.expanded !== false);
  const toggle =
    block.type === 'toggle' ||
    (/^heading_[123]$/.test(block.type) && block.content.toggleable === true);
  const Chevron = expanded ? RiArrowDownSLine : RiArrowRightSLine;
  // Columns side by side (stacked when there is no room), a table as a grid,
  // and a synced block as its content: laid out here, where the children are.
  if (block.type === 'columns') {
    const shares = columnShares(
      childrenNodes.map(({ block: column }) =>
        typeof column.content.ratio === 'number' ? column.content.ratio : undefined,
      ),
    );
    return (
      <View className="flex-row flex-wrap gap-4">
        {childrenNodes.map((column, index) => (
          <View
            key={column.block.id}
            style={{ flexGrow: shares[index] ?? 1, flexBasis: 0, minWidth: 220 }}
          >
            <BlockBranch nodes={column.children} textStyle={textStyle} />
          </View>
        ))}
      </View>
    );
  }
  if (block.type === 'table') {
    const header = block.content.withHeader === true;
    return (
      <View className="rounded-md border border-border">
        {childrenNodes.map((row, r) => (
          <View
            key={row.block.id}
            className={cn(
              'flex-row',
              r > 0 && 'border-t border-border',
              header && r === 0 && 'bg-muted/40',
            )}
          >
            {row.children.map((cell, c) => (
              <View
                key={cell.block.id}
                className={cn('flex-1 px-2 py-1', c > 0 && 'border-l border-border')}
              >
                <Text
                  className={cn('text-sm text-foreground', header && r === 0 && 'font-semibold')}
                  style={textStyle}
                >
                  <BlockText content={cell.block.content} />
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  }
  if (block.type === 'sync_block') {
    return <SyncedContent block={block} childrenNodes={childrenNodes} textStyle={textStyle} />;
  }
  if (block.type === 'column') {
    return <BlockBranch nodes={childrenNodes} textStyle={textStyle} />;
  }
  // A canvas note, read as a page: its blocks in a frame, not under a line.
  if (block.type === 'canvas_note') {
    return (
      <View className="gap-1.5 rounded-xl border border-border px-3 py-2">
        <BlockBranch nodes={childrenNodes} textStyle={textStyle} />
      </View>
    );
  }
  return (
    <View className="gap-1.5">
      <View className="flex-row items-center gap-1">
        {toggle ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={t(expanded ? 'sharing.blocks.collapse' : 'sharing.blocks.expand', {
              title: getText(block.content) || t('sharing.blocks.untitledHeading'),
            })}
            onPress={() => setExpanded((value) => !value)}
            className="p-1"
          >
            <Chevron width={18} height={18} fill={colors.mutedForeground} />
          </Pressable>
        ) : null}
        <View className="flex-1">
          <SharedBlockRenderer block={block} listIndex={listIndex} textStyle={textStyle} />
        </View>
      </View>
      {childrenNodes.length && (!toggle || expanded) ? (
        <View className="pl-4 border-l border-border">
          <BlockBranch nodes={childrenNodes} textStyle={textStyle} />
        </View>
      ) : null}
    </View>
  );
}
