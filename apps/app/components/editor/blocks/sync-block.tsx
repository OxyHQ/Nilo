/**
 * A synced block (`lib/editor/synced-blocks.ts`).
 *
 * - An original holds its content as its children, edited in place like any
 *   container, framed so it reads as synced, with where else it is shown.
 * - A reference shows its original's blocks live from the original's page:
 *   that page's document is opened here (shared with anywhere else it is
 *   open, `lib/editor/shared-sessions.ts`) and its original's children are
 *   laid out with Bloom's `BlockList` over that page's own store, so editing
 *   them here edits the original — when the reader may edit that page; read
 *   only otherwise.
 */
import {
  appendChild,
  BlockList,
  EditorController,
  EditorSurface,
  type EditorStore,
} from '@oxy.so/bloom-editor';
import { Button } from '@oxy.so/bloom/button';
import { RiExternalLinkLine } from '@oxy.so/bloom/icons/RiExternalLinkLine';
import { RiFileCopyLine } from '@oxy.so/bloom/icons/RiFileCopyLine';
import { RiRefreshLine } from '@oxy.so/bloom/icons/RiRefreshLine';
import { Loading } from '@oxy.so/bloom/loading';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@oxy.so/bloom/typography';
import { syncedSource } from '@oxy.so/nilo-contracts';
import axios from 'axios';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { View } from 'react-native';
import { blockLink, useEditorExtras } from '@/components/page-editor/editor-extras';
import {
  embeddedSlashItems,
  useActiveEmbeddedController,
  useEmbeddedEditor,
} from '@/components/page-editor/embedded-editor';
import { useTranslation } from '@/hooks/useTranslation';
import { PAGE_DOM_PREFIX, syncedSurfacePrefix } from '@/lib/editor/dom-ids';
import { insertContainer } from '@/lib/editor/insert-blocks';
import {
  isSyncedOriginal,
  type SyncedRef,
  syncedClipboard,
  syncedSourceFor,
  unsyncReference,
} from '@/lib/editor/synced-blocks';
import { usePageEditor } from '@/lib/editor/use-page-editor';
import { usePage } from '@/lib/hooks/use-pages';
import { useSyncedUsages } from '@/lib/hooks/use-synced-blocks';
import { hasRole } from '@/lib/hooks/workspace-roles';
import { useColorScheme } from '@/lib/useColorScheme';
import type { BlockComponentProps } from './types';

/** The originals shown around a block: a reference inside its own original shows nothing. */
const SyncedPathContext = createContext<ReadonlySet<string>>(new Set());

/** The DOM id prefix of the surface a block is drawn in (`lib/editor/dom-ids.ts`). */
const SurfacePrefixContext = createContext<string>(PAGE_DOM_PREFIX);

const noop = () => () => {};

/**
 * "Copy and sync" on `blockId`: the block made an original if it is not one
 * (or the original a reference shows), kept for "Paste synced block", and a
 * link to it on the system clipboard.
 */
export function useCopyAndSync() {
  const { t } = useTranslation();
  return useCallback(
    async (store: EditorStore, pageId: string, blockId: string) => {
      const source = syncedSourceFor(store, pageId, blockId);
      if (!source) {
        toast.error(t('editor.blocks.syncBlock.cannotSync'));
        return;
      }
      syncedClipboard.set(source);
      try {
        await Clipboard.setStringAsync(blockLink(source.pageId, source.blockId));
      } catch {
        // The original is kept for pasting here either way.
      }
      toast.success(t('editor.blocks.syncBlock.copied'));
    },
    [t],
  );
}

export function SyncBlock(props: BlockComponentProps) {
  const source = syncedSource('sync_block', props.block.content as Record<string, unknown>);
  return source ? <SyncedReference {...props} source={source} /> : <SyncedOriginal {...props} />;
}

/** The frame both kinds are drawn in: synced content reads as such. */
function SyncedFrame({ header, children }: { header: ReactNode; children?: ReactNode }) {
  const { colors } = useColorScheme();
  return (
    <View
      className="my-1 rounded-md border px-2 pb-1"
      style={{ borderColor: colors.primary }}
      accessibilityRole="summary"
    >
      <View className="flex-row flex-wrap items-center gap-2 py-1">
        <RiRefreshLine width={14} height={14} fill={colors.primary} />
        {header}
      </View>
      {children}
    </View>
  );
}

function SyncedNotice({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <SyncedFrame
      header={
        <>
          <Text className="flex-1 text-sm text-muted-foreground">{text}</Text>
          {action}
        </>
      }
    />
  );
}

function SyncedOriginal({ block, readOnly, renderChildren, store }: BlockComponentProps) {
  const { t } = useTranslation();
  const copy = useCopyAndSync();
  const usages = useSyncedUsages(block.id);
  const elsewhere = new Set(
    (usages.data?.references ?? []).map((r) => r.page.id).filter((id) => id !== block.pageId),
  ).size;
  const empty = useSyncExternalStore(
    store?.subscribe ?? noop,
    () => (store?.doc.blocks[block.id]?.children.length ?? 0) === 0,
  );
  return (
    <SyncedFrame
      header={
        <>
          <Text className="text-xs text-muted-foreground">
            {t('editor.blocks.syncBlock.label')}
            {elsewhere > 0
              ? ` · ${t('editor.blocks.syncBlock.shownOn', { count: elsewhere })}`
              : ''}
          </Text>
          <View className="flex-1" />
          {!readOnly && store ? (
            <Button
              appearance="subtle"
              tone="neutral"
              size="xs"
              leadingIcon={RiFileCopyLine}
              onPress={() => void copy(store, block.pageId, block.id)}
            >
              {t('editor.blocks.syncBlock.copy')}
            </Button>
          ) : null}
        </>
      }
    >
      {renderChildren?.(block.id)}
      {empty ? (
        !readOnly && store ? (
          <Button
            appearance="subtle"
            tone="neutral"
            size="xs"
            onPress={() => {
              store.sealHistory();
              store.run((c) => appendChild(c, block.id, 'paragraph'));
            }}
          >
            {t('editor.blocks.syncBlock.addBlock')}
          </Button>
        ) : (
          <Text className="text-sm text-muted-foreground">
            {t('editor.blocks.syncBlock.empty')}
          </Text>
        )
      ) : null}
    </SyncedFrame>
  );
}

/**
 * A reference: its original, as the reader may see it. It holds nothing of
 * its own; a block dropped into one is shown after it, to be moved out.
 */
function SyncedReference(props: BlockComponentProps & { source: SyncedRef }) {
  const { block, store, renderChildren } = props;
  const holds = useSyncExternalStore(
    store?.subscribe ?? noop,
    () => (store?.doc.blocks[block.id]?.children.length ?? 0) > 0,
  );
  return (
    <>
      <SyncedReferenceBody {...props} />
      {holds ? renderChildren?.(block.id) : null}
    </>
  );
}

function SyncedReferenceBody({
  block,
  readOnly,
  store,
  source,
}: BlockComponentProps & { source: SyncedRef }) {
  const { t } = useTranslation();
  const path = useContext(SyncedPathContext);
  const page = usePage(path.has(source.blockId) ? undefined : source.pageId);
  const remove = () => {
    if (!store?.doc.blocks[block.id]) return;
    store.sealHistory();
    store.run((c) => unsyncReference(c, block.id, { root: [], blocks: {} }, source.blockId));
  };
  const removeAction =
    !readOnly && store ? (
      <Button appearance="subtle" tone="neutral" size="xs" onPress={remove}>
        {t('editor.blocks.syncBlock.remove')}
      </Button>
    ) : undefined;

  if (path.has(source.blockId)) return <SyncedNotice text={t('editor.blocks.syncBlock.loop')} />;
  if (page.isLoading) {
    return (
      <SyncedFrame
        header={<Loading variant="inline" text={t('editor.blocks.syncBlock.loading')} />}
      />
    );
  }
  if (page.isError || !page.data) {
    const status = axios.isAxiosError(page.error) ? page.error.response?.status : undefined;
    if (status === 404)
      return <SyncedNotice text={t('editor.blocks.syncBlock.deleted')} action={removeAction} />;
    return (
      <SyncedNotice
        text={t(
          status === 403
            ? 'editor.blocks.syncBlock.noAccess'
            : 'editor.blocks.syncBlock.unavailable',
        )}
      />
    );
  }
  const sourcePage = page.data.page;
  if (sourcePage.archived) {
    return <SyncedNotice text={t('editor.blocks.syncBlock.deleted')} action={removeAction} />;
  }
  const editable = readOnly !== true && hasRole(page.data.role, 'editor') && !sourcePage.locked;
  return (
    <LiveReference
      referenceId={block.id}
      hostPageId={block.pageId}
      hostStore={store}
      hostReadOnly={readOnly === true}
      source={source}
      editable={editable}
      title={sourcePage.title || t('editor.blocks.syncBlock.untitled')}
      removeAction={removeAction}
    />
  );
}

function LiveReference({
  referenceId,
  hostPageId,
  hostStore,
  hostReadOnly,
  source,
  editable,
  title,
  removeAction,
}: {
  referenceId: string;
  hostPageId: string;
  hostStore?: EditorStore;
  hostReadOnly: boolean;
  source: SyncedRef;
  editable: boolean;
  title: string;
  removeAction?: ReactNode;
}) {
  const { t } = useTranslation();
  const embedded = useEmbeddedEditor();
  const session = usePageEditor(source.pageId, !editable, { embedded: true });
  const { store } = session;
  // Links, pasted images and code are the source page's: its blocks are edited here.
  const extras = useEditorExtras(source.pageId, store, !editable);
  const controller = useMemo(() => (store ? new EditorController(store) : null), [store]);
  useActiveEmbeddedController(editable ? controller : null);
  const path = useContext(SyncedPathContext);
  const inner = useMemo(() => new Set([...path, source.blockId]), [path, source.blockId]);
  // Its own block ids on web: the original's blocks may be on this page too.
  const domIdPrefix = syncedSurfacePrefix(useContext(SurfacePrefixContext), referenceId);
  const original = useSyncExternalStore(
    store?.subscribe ?? noop,
    () => store?.getSnapshot().doc.blocks[source.blockId],
  );
  const renderers = useMemo(
    () => (store && embedded ? embedded.renderersFor(source.pageId, store, !editable) : {}),
    [store, embedded, source.pageId, editable],
  );
  const slashItems = useMemo(
    () => embeddedSlashItems(embedded?.slashItems ?? []),
    [embedded?.slashItems],
  );
  const onSlashAction = useCallback(
    (id: string, blockId: string) => {
      if (store && editable) insertContainer(store, id, blockId);
    },
    [store, editable],
  );

  if (session.error) {
    return <SyncedNotice text={t('editor.blocks.syncBlock.unavailable')} />;
  }
  if (!store || !controller || !embedded) {
    return (
      <SyncedFrame
        header={<Loading variant="inline" text={t('editor.blocks.syncBlock.loading')} />}
      />
    );
  }
  if (!isSyncedOriginal(original)) {
    return <SyncedNotice text={t('editor.blocks.syncBlock.deleted')} action={removeAction} />;
  }
  const openOriginal = () =>
    router.push({
      pathname: '/(app)/p/[pageId]',
      params: { pageId: source.pageId, blockId: source.blockId },
    });
  const unsync = () => {
    if (!hostStore?.doc.blocks[referenceId]) return;
    hostStore.sealHistory();
    hostStore.run((c) => unsyncReference(c, referenceId, store.doc, source.blockId));
  };

  return (
    <SyncedFrame
      header={
        <>
          <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>
            {t('editor.blocks.syncBlock.from', { title })}
          </Text>
          {source.pageId !== hostPageId ? (
            <Button
              appearance="subtle"
              tone="neutral"
              size="xs"
              leadingIcon={RiExternalLinkLine}
              onPress={openOriginal}
            >
              {t('editor.blocks.syncBlock.editOriginal')}
            </Button>
          ) : null}
          {!hostReadOnly && hostStore ? (
            <Button appearance="subtle" tone="neutral" size="xs" onPress={unsync}>
              {t('editor.blocks.syncBlock.unsync')}
            </Button>
          ) : null}
        </>
      }
    >
      <SyncedPathContext.Provider value={inner}>
        <SurfacePrefixContext.Provider value={domIdPrefix}>
          <EditorSurface
            {...extras}
            store={store}
            controller={controller}
            slashItems={slashItems}
            onSlashAction={onSlashAction}
            renderers={renderers}
            markers={embedded.markers}
            theme={embedded.theme}
            labels={embedded.labels}
            mentions={embedded.mentions}
            onOpenMention={embedded.onOpenMention}
            onOpenLink={embedded.onOpenLink}
            readOnly={!editable}
            domIdPrefix={domIdPrefix}
          >
            <BlockList ids={original?.children ?? []} depth={0} />
          </EditorSurface>
        </SurfacePrefixContext.Provider>
      </SyncedPathContext.Provider>
      {original?.children.length === 0 ? (
        editable ? (
          <Button
            appearance="subtle"
            tone="neutral"
            size="xs"
            onPress={() => {
              store.sealHistory();
              store.run((c) => appendChild(c, source.blockId, 'paragraph'));
            }}
          >
            {t('editor.blocks.syncBlock.addBlock')}
          </Button>
        ) : (
          <Text className="text-sm text-muted-foreground">
            {t('editor.blocks.syncBlock.empty')}
          </Text>
        )
      ) : null}
    </SyncedFrame>
  );
}
