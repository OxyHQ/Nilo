import { useSlashItems } from './slash-items';
import { DatabasePicker } from './database-picker';
import { PresenceAvatars } from './presence-avatars';
import { useCreateDatabase } from '@/lib/hooks/use-databases';
import { usePage } from '@/lib/hooks/use-pages';
import { useSearchBlock } from '@/lib/hooks/use-search-block';
import {
  BlockEditor,
  type BlockSnapshot,
  composeCommands,
  type EditorStore,
  getBlock,
  insertSnapshot,
  removeBlocks,
} from '@oxy.so/bloom-editor';
import { toast } from '@oxy.so/bloom/toast';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import { usePageEditorContext } from './page-editor-context';
import { useEditorMentions } from './use-editor-mentions';
import { useOpenEditorMention, openEditorLink } from './open-target';
import { createMarkers, createRenderers } from './renderers';
import { PageCanvas } from './page-canvas';
import { AiDialog } from './ai-dialog';
import { useAiAvailable } from '@/lib/ai/use-ai';

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
  layout = 'document',
}: {
  pageId: string;
  /** Top to bottom, or the page's notes on a canvas (`page-canvas.tsx`). */
  layout?: 'document' | 'canvas';
  focusedBlockId?: string;
  readOnly?: boolean;
  /** Open the comment panel on one block. */
  onOpenBlockComments?: (blockId: string) => void;
}) {
  const { t } = useTranslation();
  const {
    store,
    status,
    rejected,
    collaborators,
    error,
    controller,
    decorations,
    theme,
    labels,
    aiTarget,
    setAiTarget,
  } = usePageEditorContext();
  const aiAvailable = useAiAvailable() && !readOnly;
  const { colors } = useColorScheme();
  useSearchBlock(focusedBlockId, true);
  const page = usePage(pageId);
  const createDatabase = useCreateDatabase();
  const [linkTarget, setLinkTarget] = useState<{ blockId: string; store: EditorStore } | null>(
    null,
  );
  const creatingDatabase = useRef(false);
  const currentEditor = useRef<{ store: EditorStore | null; readOnly: boolean }>({
    store,
    readOnly,
  });
  const workspaceId = useRef<string | undefined>(undefined);
  workspaceId.current = page.data?.page.workspaceId;
  const mentions = useEditorMentions(pageId, page.data?.page.workspaceId);
  const onOpenMention = useOpenEditorMention();
  const slashItems = useSlashItems();
  const renderers = useMemo(() => (store ? createRenderers(pageId, store) : {}), [pageId, store]);
  const markers = useMemo(() => createMarkers(), []);
  // The latest callback, read when pressed: the actions (and so the editor's
  // context) stay stable when the screen passes a new function each render.
  const openComments = useRef(onOpenBlockComments);
  openComments.current = onOpenBlockComments;
  const canComment = onOpenBlockComments !== undefined;
  const blockActions = useMemo(
    () => [
      ...(aiAvailable
        ? [
            {
              id: 'ai',
              label: t('ai.ask'),
              onPress: (id: string) => setAiTarget({ kind: 'block', blockId: id }),
            },
          ]
        : []),
      ...(canComment
        ? [
            {
              id: 'comment',
              label: t('editor.ui.comment'),
              onPress: (id: string) => openComments.current?.(id),
            },
          ]
        : []),
    ],
    [aiAvailable, canComment, setAiTarget, t],
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
      if (id === 'linkedDatabase') {
        setLinkTarget({ blockId, store });
        return;
      }
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
  if (!store || !controller) {
    return (
      <View className="px-1 py-6">
        <ActivityIndicator
          color={colors.mutedForeground}
          accessibilityLabel={t('common.loading')}
        />
      </View>
    );
  }

  const editorProps = {
    store,
    controller,
    decorations,
    mentions,
    onOpenMention,
    onOpenLink: openEditorLink,
    slashItems,
    onSlashAction,
    renderers,
    markers,
    blockActions,
    theme,
    labels,
    readOnly,
  };

  return (
    <View className={layout === 'canvas' ? 'flex-1' : undefined}>
      {!readOnly || status === 'offline' ? (
        <View
          className={
            layout === 'canvas'
              ? 'flex-row items-center justify-end gap-3 px-4 py-1.5'
              : 'mb-2 flex-row items-center justify-end gap-3'
          }
        >
          <PresenceAvatars collaborators={collaborators} />
          <Text
            className={
              status === 'error' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
            }
            accessibilityLiveRegion="polite"
          >
            {status === 'saving'
              ? t('editor.status.saving')
              : status === 'offline'
                ? t(readOnly ? 'editor.status.offlineCopy' : 'editor.status.offline')
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
      {linkTarget && page.data?.page.workspaceId && !readOnly ? (
        <DatabasePicker
          workspaceId={page.data.page.workspaceId}
          onClose={() => setLinkTarget(null)}
          onChoose={(databaseId) => {
            if (
              currentEditor.current.store === linkTarget.store &&
              !currentEditor.current.readOnly
            ) {
              insertBlockSnapshot(
                linkTarget.store,
                { type: 'inline_database', props: { databaseId } },
                linkTarget.blockId,
              );
            }
            setLinkTarget(null);
          }}
        />
      ) : null}
      {aiTarget && aiAvailable ? (
        <AiDialog store={store} target={aiTarget} onClose={() => setAiTarget(null)} />
      ) : null}
      {layout === 'canvas' ? <PageCanvas {...editorProps} /> : <BlockEditor {...editorProps} />}
    </View>
  );
}
