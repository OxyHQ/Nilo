import { useSlashItems } from './slash-items';
import { DatabasePicker } from './database-picker';
import { PresenceAvatars } from './presence-avatars';
import { useCreateDatabase, useDeleteDatabase } from '@/lib/hooks/use-databases';
import { usePageComments } from '@/lib/hooks/use-comments';
import { useCreatePage, usePage } from '@/lib/hooks/use-pages';
import { useSearchBlock } from '@/lib/hooks/use-search-block';
import { runCommand } from '@/lib/editor/run-command';
import {
  BlockEditor,
  type BlockSnapshot,
  composeCommands,
  type EditorStore,
  getBlock,
  insertSnapshot,
  removeBlocks,
  setProps,
} from '@oxy.so/bloom-editor';
import { useDialogControl } from '@oxy.so/bloom/dialog';
import { toast } from '@oxy.so/bloom/toast';
import { router } from 'expo-router';
import { BlockCommentsProvider, openCommentCounts } from '@/components/comments/comment-indicator';
import { IconPicker } from '@/components/page-chrome/icon-picker';
import { MemberProfileCard } from './member-profile-card';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { usePageEditorContext } from './page-editor-context';
import { useEditorMentions } from './use-editor-mentions';
import { useOpenEditorMention, openEditorLink } from './open-target';
import { createMarkers, createRenderers } from './renderers';
import { PageCanvas } from './page-canvas';
import { AiDialog } from './ai-dialog';
import { useAiAvailable } from '@/lib/ai/use-ai';

const paragraph = (): BlockSnapshot => ({ type: 'paragraph', text: [] });

/** What a refused change is told as; any other refusal is the page turning read-only. */
const REJECTION_MESSAGES: Record<string, string> = {
  UPDATE_TOO_LARGE: 'editor.status.tooLarge',
  PAGE_ARCHIVED: 'editor.status.archived',
  DEVICE_STORE: 'editor.status.deviceStore',
};

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

/**
 * Insert `snapshot` after `blockId`, replacing the block when it is empty.
 * The block gone meanwhile (a collaborator removed it while a database was
 * being made for it), the new block goes at the end of the page instead of
 * nowhere.
 */
function insertBlockSnapshot(store: EditorStore, snapshot: BlockSnapshot, blockId: string): void {
  const anchor = store.doc.blocks[blockId] ? blockId : null;
  const block = anchor ? getBlock(store.doc, anchor) : null;
  const empty =
    block !== null &&
    (block.text ?? []).every((segment) => !segment.text) &&
    block.children.length === 0;
  store.sealHistory();
  store.run((ctx) =>
    composeCommands(ctx, [
      (c) => insertSnapshot(c.doc, [snapshot], anchor, c.newId, c.schema),
      (c) => (empty && anchor ? removeBlocks(c, [anchor]) : null),
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
  useSearchBlock(focusedBlockId, true);
  const page = usePage(pageId);
  const createDatabase = useCreateDatabase();
  const deleteDatabase = useDeleteDatabase();
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
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const onOpenMention = useOpenEditorMention(setProfileUserId);
  const slashItems = useSlashItems();
  const renderers = useMemo(
    () => (store ? createRenderers(pageId, store, readOnly) : {}),
    [pageId, store, readOnly],
  );
  const iconPicker = useDialogControl();
  const calloutTarget = useRef<string | null>(null);
  const openIconPicker = iconPicker.open;
  const markers = useMemo(
    () =>
      createMarkers({
        onPickCalloutIcon: (blockId) => {
          calloutTarget.current = blockId;
          openIconPicker();
        },
      }),
    [openIconPicker],
  );
  const createPage = useCreatePage();
  const creatingPage = useRef(false);
  // The latest callback, read when pressed: the actions (and so the editor's
  // context) stay stable when the screen passes a new function each render.
  const openComments = useRef(onOpenBlockComments);
  openComments.current = onOpenBlockComments;
  const canComment = onOpenBlockComments !== undefined;
  const comments = usePageComments(canComment ? pageId : undefined);
  const commentCounts = useMemo(
    () => openCommentCounts(comments.data?.comments ?? []),
    [comments.data?.comments],
  );
  const openBlockComments = useCallback((blockId: string) => openComments.current?.(blockId), []);
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
  const createPageAsync = createPage.mutateAsync;
  const onSlashAction = useCallback(
    async (id: string, blockId: string) => {
      if (!store || readOnly) return;
      if (id === 'linkedDatabase') {
        setLinkTarget({ blockId, store });
        return;
      }
      if (id === 'childPage') {
        // A subpage of this one, shown here (Notion's "Page"); it is opened at
        // once, as Notion does. Made but not placed (the page closed or turned
        // read-only meanwhile), it is still a subpage in the sidebar.
        const workspace = workspaceId.current;
        if (!workspace || creatingPage.current) return;
        creatingPage.current = true;
        try {
          const child = await createPageAsync({ workspaceId: workspace, parentId: pageId });
          if (currentEditor.current.store === store && !currentEditor.current.readOnly) {
            insertBlockSnapshot(
              store,
              { type: 'child_page', props: { pageId: child.id } },
              blockId,
            );
            router.push({ pathname: '/(app)/p/[pageId]', params: { pageId: child.id } });
          }
        } catch {
          toast.error(t('editor.blocks.childPage.createFailed'));
        } finally {
          creatingPage.current = false;
        }
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
        } else {
          // The page closed or turned read-only meanwhile: no block will show
          // the database, so it goes to the trash (a hard delete is an owner's).
          deleteDatabase.mutate({ id: database.id, workspaceId: workspace });
        }
      } catch {
        toast.error(t('editor.inlineDatabase.createFailed'));
      } finally {
        creatingDatabase.current = false;
      }
    },
    [store, readOnly, pageId, t, createDatabaseAsync, createPageAsync, deleteDatabase.mutate],
  );

  useEffect(() => {
    if (!rejected) return;
    toast.error(t(REJECTION_MESSAGES[rejected.code] ?? 'editor.status.rejected'));
  }, [rejected, t]);

  if (error) {
    return (
      <Text className="px-1 py-6 text-sm text-destructive web:select-text">{error.message}</Text>
    );
  }
  if (!store || !controller) {
    return (
      <View className="px-1 py-6">
        <Loading variant="spinner" accessibilityLabel={t('common.loading')} />
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
        <AiDialog
          store={store}
          target={aiTarget}
          canvas={layout === 'canvas'}
          onClose={() => setAiTarget(null)}
        />
      ) : null}
      {profileUserId ? (
        <MemberProfileCard userId={profileUserId} onClose={() => setProfileUserId(null)} />
      ) : null}
      {readOnly ? null : (
        <IconPicker
          control={iconPicker}
          pageId={pageId}
          variant="callout"
          title={t('editor.blocks.callout.changeIcon')}
          onSelect={(icon) => {
            const target = calloutTarget.current;
            calloutTarget.current = null;
            if (!icon || !target || currentEditor.current.store !== store) return;
            if (currentEditor.current.readOnly || !store.doc.blocks[target]) return;
            runCommand(store, (c) => setProps(c, target, { icon }));
          }}
        />
      )}
      <BlockCommentsProvider counts={commentCounts} open={openBlockComments}>
        {layout === 'canvas' ? <PageCanvas {...editorProps} /> : <BlockEditor {...editorProps} />}
      </BlockCommentsProvider>
    </View>
  );
}
