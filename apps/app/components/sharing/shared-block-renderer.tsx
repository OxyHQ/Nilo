import { BlockText, blockTextSegments, PublicMentionContext } from './block-text';
import { blockFileId, type FileUrlScope } from '@nilo/contracts';
import { Divider } from '@oxy.so/bloom/divider';
import { Text } from '@oxy.so/bloom/typography';
import { useQueryClient } from '@tanstack/react-query';
import { Image as ExpoImage } from 'expo-image';
import { Platform, Pressable, type TextStyle, View } from 'react-native';
import {
  FileScopeProvider,
  freshFileUrl,
  useFileImageSource,
  useFileScope,
} from '@/lib/files/file-urls';
import { CalloutIcon } from '@/components/page-chrome/callout-icon';
import type { PageFont } from '@/lib/types/pages';
import { MONO_FONT_FAMILY, PAGE_FONT_FAMILIES } from '@/lib/fonts';
import { RiCheckLine } from '@oxy.so/bloom/icons/RiCheckLine';
import { RiArrowRightSLine } from '@oxy.so/bloom/icons/RiArrowRightSLine';
import { RiArrowDownSLine } from '@oxy.so/bloom/icons/RiArrowDownSLine';
import { RiFileLine } from '@oxy.so/bloom/icons/RiFileLine';
import { useColorScheme } from '@/lib/useColorScheme';
import {
  buildBlockTree,
  inReadingOrder,
  type ReadOnlyBlock,
  type BlockTreeNode,
} from '@/lib/block-tree';
import { useMemo, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

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

/** Bloom's `Text` sets its face inline, so code names its own. */
const MONO_STYLE = { fontFamily: MONO_FONT_FAMILY };

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
  const { colors } = useColorScheme();
  const checked = getChecked(content);
  return (
    <View className="flex-row gap-2 items-start">
      <View
        className="h-5 w-5 rounded border border-border items-center justify-center mt-0.5"
        style={{
          backgroundColor: checked ? colors.foreground : 'transparent',
        }}
      >
        {checked ? <RiCheckLine size="xs" fill={colors.background} /> : null}
      </View>
      <Text
        className={`text-base leading-7 flex-1 ${
          checked ? 'text-muted-foreground line-through' : 'text-foreground'
        }`}
        style={textStyle}
      >
        <BlockText content={content} />
      </Text>
    </View>
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

function CodeBlock({ content, textStyle }: BlockProps) {
  const text = getText(content);
  const language = getLanguage(content);
  return (
    <View className="rounded-lg border border-border bg-muted/40 overflow-hidden">
      <View className="flex-row items-center justify-between px-3 py-1.5 border-b border-border/60">
        <Text className="text-[11px] text-muted-foreground" style={textStyle}>
          {language}
        </Text>
      </View>
      <View className="p-3">
        <Text className="text-sm text-foreground" style={MONO_STYLE}>
          {text}
        </Text>
      </View>
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
  const fileSource = useFileImageSource(useFileScope(undefined), fileId);
  const url = fileId ? (fileSource?.uri ?? null) : stringOf(content.url);
  const caption = stringOf(content.caption);
  if (!url) {
    return fileId ? (
      <View className="rounded-lg bg-muted/40" style={{ width: '100%', aspectRatio: 16 / 9 }} />
    ) : null;
  }
  return (
    <View className="gap-1">
      <ExpoImage
        source={fileSource ?? { uri: url }}
        style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 8 }}
        contentFit="contain"
        accessibilityLabel={stringOf(content.alt) || caption || undefined}
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
      {failed ? (
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
    case 'columns':
    case 'column':
    case 'table':
    case 'table_row':
      return null;
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
    default:
      return (
        <Text className="text-sm text-muted-foreground italic" style={textStyle}>
          {t('sharing.blocks.unsupported', { type: block.type })}
        </Text>
      );
  }
}

/** Shared nesting and sibling ordering for published pages and version previews. */
export function SharedBlockTree({
  blocks,
  publicSlug,
  font = 'default',
  fileScope,
}: {
  blocks: readonly ReadOnlyBlock[];
  publicSlug?: string;
  font?: PageFont;
  /** How the reader reached these blocks, which is how their files are asked for. */
  fileScope?: FileUrlScope;
}) {
  const { t } = useTranslation();
  const textStyle = useMemo(() => ({ fontFamily: PAGE_FONT_FAMILIES[font] }), [font]);
  const tree = useMemo(() => inReadingOrder(buildBlockTree(blocks)), [blocks]);
  if (!tree.length)
    return (
      <Text className="text-sm text-muted-foreground" style={textStyle}>
        {t('pages.share.empty')}
      </Text>
    );
  const branch = (
    <PublicMentionContext.Provider value={publicSlug}>
      <BlockBranch nodes={tree} textStyle={textStyle} />
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
