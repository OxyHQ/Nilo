import { useCreateDatabase } from '@/lib/hooks/use-databases';
import { usePage } from '@/lib/hooks/use-pages';
import { useSearchBlock } from '@/lib/hooks/use-search-block';
import {
  BlockEditor,
  blockColors,
  type BlockSnapshot,
  composeCommands,
  type EditorLabels,
  type EditorStore,
  type EditorTheme,
  getBlock,
  insertSnapshot,
  removeBlocks,
  type SlashItem,
} from '@oxy.so/bloom-editor';
import { resolveAccentColors, useTheme } from '@oxy.so/bloom/theme';
import { toast } from '@oxy.so/bloom/toast';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import { usePageEditor } from '@/lib/editor/use-page-editor';
import { useColorScheme } from '@/lib/useColorScheme';
import { MONO_FONT_FAMILY } from '@/lib/fonts';
import { createMarkers, createRenderers } from './renderers';

/** The editor's look, from the active Bloom theme. */
function useEditorTheme(): EditorTheme {
  const theme = useTheme();
  const { colors, isDarkColorScheme } = useColorScheme();
  return useMemo(
    () => ({
      text: colors.foreground,
      textMuted: colors.mutedForeground,
      background: colors.background,
      border: colors.border,
      accent: colors.primary,
      accentText: colors.primaryForeground,
      selection: resolveAccentColors(theme.colors, 'primary', 'subtle').background,
      codeBackground: colors.muted,
      colors: blockColors(isDarkColorScheme ? 'dark' : 'light'),
      monoFontFamily: MONO_FONT_FAMILY,
    }),
    [colors, isDarkColorScheme, theme.colors],
  );
}

function useEditorLabels(): EditorLabels {
  const { t, locale } = useTranslation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `locale` re-reads the catalogs.
  return useMemo(
    () => ({
      placeholder: t('editor.ui.placeholder'),
      emptyHeading: t('editor.ui.emptyHeading'),
      emptyListItem: t('editor.ui.emptyListItem'),
      emptyToggle: t('editor.ui.emptyToggle'),
      slashNoResults: t('editor.ui.slashNoResults'),
      slashGroups: {
        basic: t('editor.slashGroups.basic'),
        media: t('editor.slashGroups.media'),
        advanced: t('editor.slashGroups.advanced'),
        embeds: t('editor.slashGroups.embeds'),
        database: t('editor.slashGroups.database'),
      },
      turnInto: t('editor.ui.turnInto'),
      duplicate: t('editor.ui.duplicate'),
      delete: t('editor.ui.delete'),
      moveUp: t('editor.ui.moveUp'),
      moveDown: t('editor.ui.moveDown'),
      indent: t('editor.ui.indent'),
      outdent: t('editor.ui.outdent'),
      color: t('editor.ui.color'),
      background: t('editor.ui.background'),
      colorNames: {
        default: t('editor.colors.default'),
        gray: t('editor.colors.gray'),
        brown: t('editor.colors.brown'),
        orange: t('editor.colors.orange'),
        yellow: t('editor.colors.yellow'),
        green: t('editor.colors.green'),
        blue: t('editor.colors.blue'),
        purple: t('editor.colors.purple'),
        pink: t('editor.colors.pink'),
        red: t('editor.colors.red'),
      },
      bold: t('editor.ui.bold'),
      italic: t('editor.ui.italic'),
      underline: t('editor.ui.underline'),
      strike: t('editor.ui.strike'),
      code: t('editor.ui.code'),
      link: t('editor.ui.link'),
      linkPlaceholder: t('editor.ui.linkPlaceholder'),
      removeLink: t('editor.ui.removeLink'),
      apply: t('editor.ui.apply'),
      blockMenu: t('editor.ui.blockMenu'),
      dragHandle: t('editor.ui.dragHandle'),
      addBelow: t('editor.ui.addBelow'),
      toggleOpen: t('editor.ui.toggleOpen'),
      toggleClosed: t('editor.ui.toggleClosed'),
      checkbox: t('editor.ui.checkbox'),
    }),
    [t, locale],
  );
}

/** Keywords for search: the catalog's comma-separated list. */
const words = (list: string) =>
  list
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);

function useSlashItems(): SlashItem[] {
  const { t, locale } = useTranslation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `locale` re-reads the catalogs.
  return useMemo(() => {
    const item = (
      id: string,
      label: string,
      description: string,
      keywords: string,
      group: string,
      action: SlashItem['action'],
    ): SlashItem => ({ id, label, description, keywords: words(keywords), group, action });
    const block = (type: string, props?: Record<string, unknown>) => ({
      kind: 'block' as const,
      type,
      props,
    });
    return [
      item(
        'paragraph',
        t('editor.slashMenu.paragraph.label'),
        t('editor.slashMenu.paragraph.description'),
        t('editor.slashMenu.paragraph.keywords'),
        'basic',
        block('paragraph'),
      ),
      item(
        'heading1',
        t('editor.slashMenu.heading1.label'),
        t('editor.slashMenu.heading1.description'),
        t('editor.slashMenu.heading1.keywords'),
        'basic',
        block('heading_1'),
      ),
      item(
        'heading2',
        t('editor.slashMenu.heading2.label'),
        t('editor.slashMenu.heading2.description'),
        t('editor.slashMenu.heading2.keywords'),
        'basic',
        block('heading_2'),
      ),
      item(
        'heading3',
        t('editor.slashMenu.heading3.label'),
        t('editor.slashMenu.heading3.description'),
        t('editor.slashMenu.heading3.keywords'),
        'basic',
        block('heading_3'),
      ),
      item(
        'bulletedList',
        t('editor.slashMenu.bulletedList.label'),
        t('editor.slashMenu.bulletedList.description'),
        t('editor.slashMenu.bulletedList.keywords'),
        'basic',
        block('bulleted_list_item'),
      ),
      item(
        'numberedList',
        t('editor.slashMenu.numberedList.label'),
        t('editor.slashMenu.numberedList.description'),
        t('editor.slashMenu.numberedList.keywords'),
        'basic',
        block('numbered_list_item'),
      ),
      item(
        'todo',
        t('editor.slashMenu.todo.label'),
        t('editor.slashMenu.todo.description'),
        t('editor.slashMenu.todo.keywords'),
        'basic',
        block('todo'),
      ),
      item(
        'toggle',
        t('editor.slashMenu.toggle.label'),
        t('editor.slashMenu.toggle.description'),
        t('editor.slashMenu.toggle.keywords'),
        'basic',
        block('toggle'),
      ),
      item(
        'quote',
        t('editor.slashMenu.quote.label'),
        t('editor.slashMenu.quote.description'),
        t('editor.slashMenu.quote.keywords'),
        'basic',
        block('quote'),
      ),
      item(
        'callout',
        t('editor.slashMenu.callout.label'),
        t('editor.slashMenu.callout.description'),
        t('editor.slashMenu.callout.keywords'),
        'basic',
        block('callout'),
      ),
      item(
        'divider',
        t('editor.slashMenu.divider.label'),
        t('editor.slashMenu.divider.description'),
        t('editor.slashMenu.divider.keywords'),
        'basic',
        block('divider'),
      ),
      item(
        'image',
        t('editor.slashMenu.image.label'),
        t('editor.slashMenu.image.description'),
        t('editor.slashMenu.image.keywords'),
        'media',
        block('image'),
      ),
      item(
        'video',
        t('editor.slashMenu.video.label'),
        t('editor.slashMenu.video.description'),
        t('editor.slashMenu.video.keywords'),
        'media',
        block('video'),
      ),
      item(
        'audio',
        t('editor.slashMenu.audio.label'),
        t('editor.slashMenu.audio.description'),
        t('editor.slashMenu.audio.keywords'),
        'media',
        block('audio'),
      ),
      item(
        'file',
        t('editor.slashMenu.file.label'),
        t('editor.slashMenu.file.description'),
        t('editor.slashMenu.file.keywords'),
        'media',
        block('file'),
      ),
      item(
        'pdf',
        t('editor.slashMenu.pdf.label'),
        t('editor.slashMenu.pdf.description'),
        t('editor.slashMenu.pdf.keywords'),
        'media',
        block('pdf'),
      ),
      item(
        'bookmark',
        t('editor.slashMenu.bookmark.label'),
        t('editor.slashMenu.bookmark.description'),
        t('editor.slashMenu.bookmark.keywords'),
        'media',
        block('bookmark'),
      ),
      item(
        'code',
        t('editor.slashMenu.code.label'),
        t('editor.slashMenu.code.description'),
        t('editor.slashMenu.code.keywords'),
        'advanced',
        block('code'),
      ),
      item(
        'columns',
        t('editor.slashMenu.columns.label'),
        t('editor.slashMenu.columns.description'),
        t('editor.slashMenu.columns.keywords'),
        'advanced',
        { kind: 'custom', id: 'columns' },
      ),
      item(
        'table',
        t('editor.slashMenu.table.label'),
        t('editor.slashMenu.table.description'),
        t('editor.slashMenu.table.keywords'),
        'advanced',
        { kind: 'custom', id: 'table' },
      ),
      item(
        'button',
        t('editor.slashMenu.button.label'),
        t('editor.slashMenu.button.description'),
        t('editor.slashMenu.button.keywords'),
        'advanced',
        block('button'),
      ),
      item(
        'linkToPage',
        t('editor.slashMenu.linkToPage.label'),
        t('editor.slashMenu.linkToPage.description'),
        t('editor.slashMenu.linkToPage.keywords'),
        'advanced',
        block('link_to_page'),
      ),
      item(
        'equation',
        t('editor.slashMenu.equation.label'),
        t('editor.slashMenu.equation.description'),
        t('editor.slashMenu.equation.keywords'),
        'advanced',
        block('equation'),
      ),
      item(
        'mermaid',
        t('editor.slashMenu.mermaid.label'),
        t('editor.slashMenu.mermaid.description'),
        t('editor.slashMenu.mermaid.keywords'),
        'advanced',
        block('mermaid'),
      ),
      item(
        'tableOfContents',
        t('editor.slashMenu.tableOfContents.label'),
        t('editor.slashMenu.tableOfContents.description'),
        t('editor.slashMenu.tableOfContents.keywords'),
        'advanced',
        block('table_of_contents'),
      ),
      item(
        'breadcrumb',
        t('editor.slashMenu.breadcrumb.label'),
        t('editor.slashMenu.breadcrumb.description'),
        t('editor.slashMenu.breadcrumb.keywords'),
        'advanced',
        block('breadcrumb'),
      ),
      item(
        'embed',
        t('editor.slashMenu.embed.label'),
        t('editor.slashMenu.embed.description'),
        t('editor.slashMenu.embed.keywords'),
        'embeds',
        block('embed'),
      ),
      item(
        'youtube',
        t('editor.slashMenu.youtube.label'),
        t('editor.slashMenu.youtube.description'),
        t('editor.slashMenu.youtube.keywords'),
        'embeds',
        block('video', { source: 'youtube' }),
      ),
      item(
        'inlineDatabase',
        t('editor.slashMenu.inlineDatabase.label'),
        t('editor.slashMenu.inlineDatabase.description'),
        t('editor.slashMenu.inlineDatabase.keywords'),
        'database',
        { kind: 'custom', id: 'inlineDatabase' },
      ),
    ];
  }, [t, locale]);
}

const paragraph = (): BlockSnapshot => ({ type: 'paragraph', text: [] });

/** Containers that arrive with their structure: two columns, a 2×2 table. */
const CONTAINERS: Record<string, BlockSnapshot> = {
  columns: {
    type: 'columns',
    props: { columnCount: 2 },
    children: [
      { type: 'column', children: [paragraph()] },
      { type: 'column', children: [paragraph()] },
    ],
  },
  table: {
    type: 'table',
    props: { rows: 2, cols: 2, withHeader: false },
    children: [0, 1].map(() => ({
      type: 'table_row',
      children: [0, 1].map(() => ({ type: 'table_cell', text: [] })),
    })),
  },
};

/** Insert a container after `blockId`, replacing the block when it is empty. */
function insertContainer(store: EditorStore, id: string, blockId: string): void {
  const snapshot = CONTAINERS[id];
  if (!snapshot) return;
  insertBlockSnapshot(store, snapshot, blockId);
}

function insertBlockSnapshot(store: EditorStore, snapshot: BlockSnapshot, blockId: string): void {
  if (!store.doc.blocks[blockId]) return;
  const block = getBlock(store.doc, blockId);
  const empty = (block.text ?? []).every((segment) => !segment.text) && block.children.length === 0;
  store.sealHistory();
  store.run((ctx) =>
    composeCommands(ctx, [
      (c) => insertSnapshot(c.doc, [snapshot], blockId, c.newId, c.schema),
      (c) => (empty ? removeBlocks(c, [blockId]) : null),
    ]),
  );
}

export function PageEditor({
  pageId,
  readOnly = false,
  onOpenBlockComments,
  focusedBlockId,
}: {
  pageId: string;
  focusedBlockId?: string;
  readOnly?: boolean;
  /** Open the comment panel on one block. */
  onOpenBlockComments?: (blockId: string) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const { store, status, rejected, collaborators, error } = usePageEditor(pageId, readOnly);
  useSearchBlock(focusedBlockId, Boolean(store));
  const page = usePage(pageId);
  const createDatabase = useCreateDatabase();
  const creatingDatabase = useRef(false);
  const currentEditor = useRef({ store, readOnly });
  const workspaceId = useRef<string | undefined>(undefined);
  workspaceId.current = page.data?.page.workspaceId;
  const theme = useEditorTheme();
  const labels = useEditorLabels();
  const slashItems = useSlashItems();
  const renderers = useMemo(() => (store ? createRenderers(pageId, store) : {}), [pageId, store]);
  const markers = useMemo(() => createMarkers(), []);
  // The latest callback, read when pressed: the actions (and so the editor's
  // context) stay stable when the screen passes a new function each render.
  const openComments = useRef(onOpenBlockComments);
  openComments.current = onOpenBlockComments;
  const canComment = onOpenBlockComments !== undefined;
  const blockActions = useMemo(
    () =>
      canComment
        ? [
            {
              id: 'comment',
              label: t('editor.ui.comment'),
              onPress: (id: string) => openComments.current?.(id),
            },
          ]
        : [],
    [canComment, t],
  );

  useEffect(() => {
    currentEditor.current = { store, readOnly };
    return () => {
      currentEditor.current = { store: null, readOnly: true };
    };
  }, [store, readOnly]);

  // Stable across renders: the editor's context (and so every block) depends on it.
  const createDatabaseAsync = createDatabase.mutateAsync;
  const onSlashAction = useCallback(
    async (id: string, blockId: string) => {
      if (!store || readOnly) return;
      if (id !== 'inlineDatabase') {
        insertContainer(store, id, blockId);
        return;
      }
      const workspace = workspaceId.current;
      if (!workspace || creatingDatabase.current) return;
      creatingDatabase.current = true;
      try {
        const { database } = await createDatabaseAsync({
          workspaceId: workspace,
          parentPageId: pageId,
          isInline: true,
          name: t('editor.inlineDatabase.defaultName'),
        });
        if (currentEditor.current.store === store && !currentEditor.current.readOnly) {
          insertBlockSnapshot(
            store,
            { type: 'inline_database', props: { databaseId: database.id } },
            blockId,
          );
        }
      } catch {
        toast.error(t('editor.inlineDatabase.createFailed'));
      } finally {
        creatingDatabase.current = false;
      }
    },
    [store, readOnly, pageId, t, createDatabaseAsync],
  );

  useEffect(() => {
    if (rejected) toast.error(t('editor.status.rejected'));
  }, [rejected, t]);

  if (error) {
    return <Text className="px-1 py-6 text-sm text-destructive">{error.message}</Text>;
  }
  if (!store) {
    return (
      <View className="px-1 py-6">
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }

  return (
    <View>
      {!readOnly ? (
        <View className="mb-2 flex-row items-center justify-end gap-3">
          {collaborators.length > 1 ? (
            <Text className="text-xs text-muted-foreground">
              {t('editor.status.collaborators', { count: collaborators.length - 1 })}
            </Text>
          ) : null}
          <Text
            className={
              status === 'error' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
            }
            accessibilityLiveRegion="polite"
          >
            {status === 'saving'
              ? t('editor.status.saving')
              : status === 'offline'
                ? t('editor.status.offline')
                : status === 'error'
                  ? t('editor.status.error')
                  : t('editor.status.saved')}
          </Text>
        </View>
      ) : null}
      {createDatabase.isPending ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-muted-foreground">
          {t('editor.inlineDatabase.creating')}
        </Text>
      ) : null}
      <BlockEditor
        store={store}
        slashItems={slashItems}
        onSlashAction={onSlashAction}
        renderers={renderers}
        markers={markers}
        blockActions={blockActions}
        theme={theme}
        labels={labels}
        readOnly={readOnly}
      />
    </View>
  );
}
