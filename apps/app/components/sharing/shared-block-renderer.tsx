import { BlockText, blockTextSegments, PublicMentionContext } from './block-text';
import { Pressable, View } from 'react-native';
import { CalloutIcon } from '@/components/page-chrome/callout-icon';
import { Text, TextStyleContext } from '@/components/ui/text';
import type { PageFont } from '@/lib/types/pages';
import { MONO_FONT_FAMILY, PAGE_FONT_FAMILIES } from '@/lib/fonts';
import { Check, ChevronRight, ChevronDown } from 'lucide-react-native';
import { useColorScheme } from '@/lib/useColorScheme';
import { buildBlockTree, type ReadOnlyBlock, type BlockTreeNode } from '@/lib/block-tree';
import { useMemo, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

interface SharedBlockRendererProps {
  block: ReadOnlyBlock;
  listIndex?: number;
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

function ParagraphBlock({ content }: { content: Record<string, unknown> }) {
  const { t } = useTranslation();
  const text = getText(content);
  return (
    <Text className="text-base leading-7 text-foreground">
      {text ? (
        <BlockText content={content} />
      ) : (
        <Text className="text-muted-foreground italic">{t('sharing.blocks.emptyParagraph')}</Text>
      )}
    </Text>
  );
}

function HeadingBlock({ content, level }: { content: Record<string, unknown>; level: 1 | 2 | 3 }) {
  const { t } = useTranslation();
  const text = <BlockText content={content} fallback={t('sharing.blocks.untitledHeading')} />;
  const className =
    level === 1
      ? 'text-3xl font-bold text-foreground mt-4'
      : level === 2
        ? 'text-2xl font-bold text-foreground mt-3'
        : 'text-xl font-semibold text-foreground mt-2';
  return (
    <Text accessibilityRole="header" className={className}>
      {text}
    </Text>
  );
}

function BulletedListBlock({ content }: { content: Record<string, unknown> }) {
  return (
    <View className="flex-row gap-2">
      <Text className="text-base leading-7 text-foreground">{'•'}</Text>
      <Text className="text-base leading-7 text-foreground flex-1">
        <BlockText content={content} />
      </Text>
    </View>
  );
}

function NumberedListBlock({
  content,
  index,
}: {
  content: Record<string, unknown>;
  index: number;
}) {
  return (
    <View className="flex-row gap-2">
      <Text className="text-base leading-7 text-foreground">{`${index}.`}</Text>
      <Text className="text-base leading-7 text-foreground flex-1">
        <BlockText content={content} />
      </Text>
    </View>
  );
}

function TodoBlock({ content }: { content: Record<string, unknown> }) {
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
        {checked ? <Check size={12} color={colors.background} /> : null}
      </View>
      <Text
        className={`text-base leading-7 flex-1 ${
          checked ? 'text-muted-foreground line-through' : 'text-foreground'
        }`}
      >
        <BlockText content={content} />
      </Text>
    </View>
  );
}

function QuoteBlock({ content }: { content: Record<string, unknown> }) {
  return (
    <View className="border-l-2 border-border pl-4 py-1">
      <Text className="text-base leading-7 text-muted-foreground italic">
        <BlockText content={content} />
      </Text>
    </View>
  );
}

function DividerBlock() {
  return <View className="h-px bg-border my-3" />;
}

function CodeBlock({ content }: { content: Record<string, unknown> }) {
  const text = getText(content);
  const language = getLanguage(content);
  return (
    <View className="rounded-lg border border-border bg-muted/40 overflow-hidden">
      <View className="flex-row items-center justify-between px-3 py-1.5 border-b border-border/60">
        <Text className="text-[11px] font-mono text-muted-foreground">{language}</Text>
      </View>
      <View className="p-3">
        <Text
          className="text-sm text-foreground"
          style={{
            fontFamily: MONO_FONT_FAMILY,
          }}
        >
          {text}
        </Text>
      </View>
    </View>
  );
}

function CalloutBlock({ content }: { content: Record<string, unknown> }) {
  return (
    <View className="flex-row gap-3 rounded-xl bg-muted/40 px-4 py-3">
      <CalloutIcon value={content.icon} size={22} />
      <Text className="text-base leading-7 text-foreground flex-1">
        <BlockText content={content} />
      </Text>
    </View>
  );
}

export function SharedBlockRenderer({ block, listIndex = 1 }: SharedBlockRendererProps) {
  const { t } = useTranslation();
  switch (block.type) {
    case 'toggle':
    case 'table_cell':
    case 'paragraph':
      return <ParagraphBlock content={block.content} />;
    case 'heading_1':
      return <HeadingBlock content={block.content} level={1} />;
    case 'heading_2':
      return <HeadingBlock content={block.content} level={2} />;
    case 'heading_3':
      return <HeadingBlock content={block.content} level={3} />;
    case 'bulleted_list_item':
      return <BulletedListBlock content={block.content} />;
    case 'numbered_list_item':
      return <NumberedListBlock content={block.content} index={listIndex} />;
    case 'todo':
      return <TodoBlock content={block.content} />;
    case 'quote':
      return <QuoteBlock content={block.content} />;
    case 'columns':
    case 'column':
    case 'table':
    case 'table_row':
      return null;
    case 'divider':
      return <DividerBlock />;
    case 'code':
      return <CodeBlock content={block.content} />;
    case 'callout':
      return <CalloutBlock content={block.content} />;
    default:
      return (
        <Text className="text-sm text-muted-foreground italic">
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
}: {
  blocks: readonly ReadOnlyBlock[];
  publicSlug?: string;
  font?: PageFont;
}) {
  const { t } = useTranslation();
  const textStyle = useMemo(() => ({ fontFamily: PAGE_FONT_FAMILIES[font] }), [font]);
  const tree = useMemo(() => buildBlockTree(blocks), [blocks]);
  if (!tree.length)
    return <Text className="text-sm text-muted-foreground">{t('pages.share.empty')}</Text>;
  return (
    <PublicMentionContext.Provider value={publicSlug}>
      <TextStyleContext.Provider value={textStyle}>
        <BlockBranch nodes={tree} />
      </TextStyleContext.Provider>
    </PublicMentionContext.Provider>
  );
}
function BlockBranch({ nodes }: { nodes: BlockTreeNode[] }) {
  let listIndex = 0;
  return (
    <View className="gap-1.5">
      {nodes.map(({ block, children }) => {
        listIndex = block.type === 'numbered_list_item' ? listIndex + 1 : 0;
        return (
          <BlockNode key={block.id} block={block} listIndex={listIndex} childrenNodes={children} />
        );
      })}
    </View>
  );
}

function BlockNode({
  block,
  listIndex,
  childrenNodes,
}: {
  block: ReadOnlyBlock;
  listIndex: number;
  childrenNodes: BlockTreeNode[];
}) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const [expanded, setExpanded] = useState(block.content.expanded !== false);
  const toggle =
    block.type === 'toggle' ||
    (/^heading_[123]$/.test(block.type) && block.content.toggleable === true);
  const Chevron = expanded ? ChevronDown : ChevronRight;
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
            <Chevron size={18} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
        <View className="flex-1">
          <SharedBlockRenderer block={block} listIndex={listIndex} />
        </View>
      </View>
      {childrenNodes.length && (!toggle || expanded) ? (
        <View className="pl-4 border-l border-border">
          <BlockBranch nodes={childrenNodes} />
        </View>
      ) : null}
    </View>
  );
}
