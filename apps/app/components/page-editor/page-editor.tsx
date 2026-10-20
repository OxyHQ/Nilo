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
  type ConfirmRemove,
  type EditorStore,
  type FormatAction,
  type PasteTextInput,
  setProps,
} from '@oxy.so/bloom-editor';
import { RiChat3Line } from '@oxy.so/bloom/icons/RiChat3Line';
import { confirm } from '@oxy.so/bloom/surfaces';
import { useDialogControl } from '@oxy.so/bloom/dialog';
import { toast } from '@oxy.so/bloom/toast';
import { router } from 'expo-router';
import { BlockCommentsProvider, openCommentCounts } from '@/components/comments/comment-indicator';
import { useCopyAndSync } from '@/components/editor/blocks/sync-block';
import { IconPicker } from '@/components/page-chrome/icon-picker';
import apiClient from '@/lib/api/client';
import { API_ROUTES } from '@/lib/api/routes';
import { anchorFor, blockText, selectionAnchor } from '@/lib/comments/anchor';
import { PAGE_DOM_PREFIX } from '@/lib/editor/dom-ids';
import { insertBlockSnapshot, insertContainer } from '@/lib/editor/insert-blocks';
import {
  originalsWithin,
  pastedSyncedReference,
  syncedClipboard,
  syncedReference,
} from '@/lib/editor/synced-blocks';
import type { SyncedUsages } from '@/lib/hooks/use-synced-blocks';
import type { CommentAnchor } from '@/lib/types/comments';
import { MemberProfileCard } from './member-profile-card';
import { EmbeddedEditorProvider, type EmbeddedEditorValue } from './embedded-editor';
import { SyncedBlockPicker } from './synced-block-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { usePageEditorContext } from './page-editor-context';
import { useEditorMentions } from './use-editor-mentions';
import { useOpenEditorMention, openEditorLink } from './open-target';
import { blockLink } from './editor-extras';
import { createMarkers, createRenderers } from './renderers';
import { useEditorExtras } from './editor-extras';
import { PageCanvas } from './page-canvas';
import { AiDialog } from './ai-dialog';
import { useAiAvailable } from '@/lib/ai/use-ai';

/** An equation typed between `$$` is a mention (the page's `@`), drawn and edited as one. */
const INLINE_EQUATIONS = { indicator: '@' } as const;

/** What a refused change is told as; any other refusal is the page turning read-only. */
const REJECTION_MESSAGES: Record<string, string> = {
  UPDATE_TOO_LARGE: 'editor.status.tooLarge',
  PAGE_ARCHIVED: 'editor.status.archived',
  DEVICE_STORE: 'editor.status.deviceStore',
};

/** Comment on the selected text: ⌘⇧M (Ctrl+Shift+M), as in Notion. */
export function isCommentShortcut(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === 'm'
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
  /** Open the comment panel on one block, on a stretch of its text when `anchor` is given. */
  onOpenBlockComments?: (blockId: string, anchor?: CommentAnchor | null) => void;
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
    setEmbeddedController,
  } = usePageEditorContext();
  const copyAndSync = useCopyAndSync();
  const [syncedTarget, setSyncedTarget] = useState<{ blockId: string; store: EditorStore } | null>(
    null,
  );
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
  const extras = useEditorExtras(pageId, store, readOnly);
  const renderers = useMemo(() => (store ? createRenderers(pageId, store) : {}), [pageId, store]);
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
      ...(!readOnly && store
        ? [
            {
              id: 'copySync',
              label: t('editor.ui.copyAndSync'),
              onPress: (id: string) => void copyAndSync(store, pageId, id),
            },
          ]
        : []),
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
              // On the text selected in this block when there is some, as Notion does.
              onPress: (id: string) =>
                openComments.current?.(id, store ? selectionAnchor(store, id)?.anchor : null),
            },
          ]
        : []),
    ],
    [aiAvailable, canComment, setAiTarget, t, readOnly, store, copyAndSync, pageId],
  );

  // "Comment" on the selected text: in the selection bubble on the web and in
  // the toolbar on touch devices (it reads them from the shared controller).
  const formatActions = useMemo<readonly FormatAction[]>(
    () =>
      canComment && store
        ? [
            {
              id: 'comment',
              label: t('editor.ui.comment'),
              icon: ({ color, size }) => <RiChat3Line width={size} height={size} fill={color} />,
              onPress: ({ blockId, start, end }) => {
                const text = blockText(store, blockId);
                const anchor = text === null ? null : anchorFor(text, start, end);
                if (anchor) openComments.current?.(blockId, anchor);
              },
            },
          ]
        : [],
    [canComment, store, t],
  );

  // Web: ⌘⇧M comments on the selected text too, as in Notion.
  useEffect(() => {
    if (Platform.OS !== 'web' || !canComment || !store) return;
    const onKey = (event: KeyboardEvent) => {
      if (!isCommentShortcut(event)) return;
      const selected = selectionAnchor(store);
      if (!selected) return;
      event.preventDefault();
      openComments.current?.(selected.blockId, selected.anchor);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [canComment, store]);

  // Deleting an original shown on other pages leaves them "Original
  // deleted": asked first. Removing anything else is not asked about.
  const confirmRemove = useCallback<ConfirmRemove>(
    (ids) => {
      if (!store) return true;
      const originals = originalsWithin(store.doc, ids);
      if (originals.length === 0) return true;
      return Promise.all(
        originals.map((id) =>
          apiClient
            .get<SyncedUsages>(API_ROUTES.syncedBlocks.usages(id))
            .then(({ data }) => data.references.filter((r) => r.page.id !== pageId).length)
            // Not known (offline, not projected yet): nothing to warn of.
            .catch(() => 0),
        ),
      ).then((counts) => {
        const count = counts.reduce((sum, n) => sum + n, 0);
        if (count === 0) return true;
        return confirm({
          title: t('editor.blocks.syncBlock.deleteDialog.title'),
          description: t('editor.blocks.syncBlock.deleteDialog.description', { count }),
          confirmLabel: t('common.delete'),
          cancelLabel: t('common.cancel'),
          destructive: true,
        });
      });
    },
    [store, pageId, t],
  );

  // Pasting the link "Copy and sync" put on the clipboard shows the original
  // here (a reference), as Notion does; any other paste is Bloom's.
  const onPasteText = useCallback(
    ({ text, blockId }: PasteTextInput) => {
      if (!store || readOnly) return false;
      const reference = pastedSyncedReference(
        store.doc,
        pageId,
        blockId,
        text,
        syncedClipboard.get(),
        (ref) => blockLink(ref.pageId, ref.blockId),
      );
      if (!reference) return false;
      insertBlockSnapshot(store, reference, blockId);
      return true;
    },
    [store, readOnly, pageId],
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
      if (id === 'pasteSyncedBlock') {
        setSyncedTarget({ blockId, store });
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

  // What a synced block's editor inside this page draws with.
  const embedded: EmbeddedEditorValue = useMemo(
    () => ({
      slashItems,
      markers,
      theme,
      labels,
      mentions,
      onOpenMention,
      onOpenLink: openEditorLink,
      renderersFor: createRenderers,
      setActiveController: setEmbeddedController,
    }),
    [slashItems, markers, theme, labels, mentions, onOpenMention, setEmbeddedController],
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
    ...extras,
    inlineEquations: INLINE_EQUATIONS,
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
    formatActions,
    onPasteText,
    confirmRemove,
    domIdPrefix: PAGE_DOM_PREFIX,
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
      {syncedTarget && page.data?.page.workspaceId && !readOnly ? (
        <SyncedBlockPicker
          workspaceId={page.data.page.workspaceId}
          onClose={() => setSyncedTarget(null)}
          onChoose={(source) => {
            if (
              currentEditor.current.store === syncedTarget.store &&
              !currentEditor.current.readOnly
            ) {
              insertBlockSnapshot(
                syncedTarget.store,
                syncedReference(source),
                syncedTarget.blockId,
              );
            }
            setSyncedTarget(null);
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
        <EmbeddedEditorProvider value={embedded}>
          {layout === 'canvas' ? <PageCanvas {...editorProps} /> : <BlockEditor {...editorProps} />}
        </EmbeddedEditorProvider>
      </BlockCommentsProvider>
    </View>
  );
}
