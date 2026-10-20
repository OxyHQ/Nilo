import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import axios from 'axios';
import { RiLockLine } from '@oxy.so/bloom/icons/RiLockLine';
import { RiChat3Line } from '@oxy.so/bloom/icons/RiChat3Line';
import { Button } from '@oxy.so/bloom/button';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Loading } from '@oxy.so/bloom/loading';
import { AppShellPanels } from '@oxy.so/bloom/app-shell';
import { ScreenScrollView } from '@oxy.so/bloom/screen';
import type { PageHeaderProps } from '@oxy.so/bloom/page-header';
import {
  PageEditorProvider,
  PageEditorToolbar,
} from '@/components/page-editor/page-editor-context';
import { PageEditor } from '@/components/page-editor/page-editor';
import { ShareButton } from '@/components/sharing';
import { CommentPanel } from '@/components/comments/comment-panel';
import { PageChrome, PageHeader, TrashedPageBanner } from '@/components/page-chrome';
import { RowPropertiesPanel } from '@/components/database/row-properties-panel';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { usePage } from '@/lib/hooks/use-pages';
import { useRouteWorkspace } from '@/lib/hooks/use-route-workspace';
import { usePageComments } from '@/lib/hooks/use-comments';
import { useDatabase } from '@/lib/hooks/use-databases';
import { useTrackRecentPage } from '@/lib/hooks/use-track-recent-page';
import { hasRole } from '@/lib/hooks/workspace-roles';
import { pageContentReadOnly } from '@/lib/hooks/page-access';
import type { DatabaseRow, PropertyValue } from '@/lib/types/databases';
import { cn } from '@/lib/utils';
import type { Page } from '@/lib/types/pages';
import type { CommentAnchor } from '@/lib/types/comments';

/**
 * Page detail route. Wraps the block editor with `PageChrome` (cover + icon
 * pickers, breadcrumb, favourite star, actions menu) and renders the title /
 * cover via `PageHeader` inside the page's ScrollView so they scroll with
 * the editor content.
 *
 * Database rows get a `RowPropertiesPanel` between the header and the
 * editor; comments appear in a right-side `CommentPanel` toggled from the
 * top bar.
 */
export default function PageDetailRoute() {
  const params = useLocalSearchParams<{
    pageId?: string | string[];
    blockId?: string | string[];
    comments?: string;
  }>();
  const pageId = Array.isArray(params.pageId) ? params.pageId[0] : params.pageId;
  const { t } = useTranslation();

  if (!pageId) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <EmptyState description={t('pages.noneSelected')} />
      </View>
    );
  }

  // Key by pageId so all child state (title draft, editor refs) resets when
  // the route param changes — no useEffect-based prop sync needed.
  return (
    <PageDetail
      pageId={pageId}
      key={pageId}
      openComments={params.comments === 'open'}
      blockId={Array.isArray(params.blockId) ? params.blockId[0] : params.blockId}
    />
  );
}

function PageDetail({
  pageId,
  blockId,
  openComments,
}: {
  pageId: string;
  blockId?: string;
  openComments: boolean;
}) {
  const router = useRouter();
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const { data, isLoading, isError, error } = usePage(pageId);
  useRouteWorkspace(data?.page.workspaceId);
  const { data: commentsData } = usePageComments(pageId, false);
  const role = data?.role;
  useTrackRecentPage(pageId);

  const [commentPanel, setCommentPanel] = React.useState<{
    open: boolean;
    focusedBlockId: string | null;
    /** The text a new comment is on, when it was asked for on a selection. */
    anchor?: CommentAnchor | null;
  }>({ open: false, focusedBlockId: null });

  React.useEffect(() => {
    if (openComments) setCommentPanel({ open: true, focusedBlockId: blockId ?? null });
  }, [openComments, blockId]);

  const openCommentCount = React.useMemo(() => {
    const comments = commentsData?.comments ?? [];
    return comments.filter((c) => c.parentCommentId === null && c.resolvedAt === null).length;
  }, [commentsData?.comments]);

  const handleOpenPanel = React.useCallback(
    (focusedBlockId: string | null = null, anchor: CommentAnchor | null = null) => {
      setCommentPanel({ open: true, focusedBlockId, anchor });
    },
    [],
  );

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Loading variant="spinner" accessibilityLabel={t('common.loading')} />
      </View>
    );
  }

  if (isError || !data?.page) {
    const noAccess =
      axios.isAxiosError(error) &&
      error.response?.status === 403 &&
      error.response.data?.code === 'NO_PAGE_ACCESS';
    const message = t(noAccess ? 'pages.noAccess' : 'pages.loadFailed');
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <View className="w-full max-w-md">
          <EmptyState
            title={message}
            action={{
              label: t('pages.backToWorkspace'),
              accessibilityLabel: t('pages.backToWorkspace'),
              onPress: () => router.replace('/(app)'),
            }}
          />
        </View>
      </View>
    );
  }

  const page = data.page;
  const canEdit = hasRole(role, 'editor');
  const contentReadOnly = pageContentReadOnly(page, role);
  const commentsLabel = t('pages.comments.openCount', { count: openCommentCount });

  const rightHeader: PageHeaderProps['actions'] = ({ compact }) => (
    <View className="flex-row items-center gap-2">
      {page.restricted ? (
        <View accessible accessibilityLabel={t('pages.restricted')}>
          <RiLockLine width={14} height={14} fill={colors.mutedForeground} />
        </View>
      ) : null}
      <Button
        appearance="subtle"
        iconOnly
        onPress={() => handleOpenPanel(null)}
        accessibilityLabel={commentsLabel}
        title={commentsLabel}
        aria-expanded={commentPanel.open}
        leadingIcon={RiChat3Line}
      />
      <ShareButton pageId={page.id} compact={compact} />
    </View>
  );

  const content = (
    <PageChrome
      page={page}
      readOnly={!canEdit}
      rightHeader={rightHeader}
      scroll={page.mode === 'canvas' ? 'none' : 'auto'}
      bottomBar={<PageEditorToolbar />}
    >
      {page.archived ? <TrashedPageBanner page={page} canEdit={canEdit} /> : null}
      {page.mode === 'canvas' ? (
        // A canvas fills the page: notes are placed on it, not scrolled through.
        <View className="flex-1">
          {page.databaseId ? (
            // A database row keeps its properties above its canvas.
            <View className="border-b border-border px-4 py-2">
              <DatabaseRowProperties page={page} readOnly={contentReadOnly} />
            </View>
          ) : null}
          <PageEditor
            pageId={page.id}
            focusedBlockId={blockId}
            readOnly={contentReadOnly}
            onOpenBlockComments={handleOpenPanel}
            layout="canvas"
          />
        </View>
      ) : (
        <ScreenScrollView keyboardShouldPersistTaps="handled">
          <PageHeader page={page} readOnly={!canEdit} />
          <View className={cn('px-6 md:px-10 w-full mx-auto pt-4', !page.fullWidth && 'max-w-3xl')}>
            <DatabaseRowProperties page={page} readOnly={contentReadOnly} />
            <PageEditor
              pageId={page.id}
              focusedBlockId={blockId}
              readOnly={contentReadOnly}
              onOpenBlockComments={handleOpenPanel}
            />
          </View>
        </ScreenScrollView>
      )}
    </PageChrome>
  );
  const closeComments = () => setCommentPanel({ open: false, focusedBlockId: null });
  return (
    <PageEditorProvider pageId={pageId} readOnly={contentReadOnly}>
      <AppShellPanels
        layout={{
          mode: 'split',
          flow: 'bounded',
          appearance: 'separated',
          activePanel: 'document',
          panels: [
            { id: 'document', span: 1, content },
            {
              id: 'comments',
              width: 360,
              minWidth: 280,
              maxWidth: 480,
              visible: commentPanel.open,
              floating: {
                below: 'xl',
                open: commentPanel.open,
                onOpenChange: (open) => {
                  if (!open) closeComments();
                },
                label: t('comments.panel.title'),
              },
              content: (
                <CommentPanel
                  canComment={hasRole(role, 'commenter')}
                  pageId={page.id}
                  workspaceId={page.workspaceId}
                  open={commentPanel.open}
                  focusedBlockId={commentPanel.focusedBlockId}
                  anchor={commentPanel.anchor ?? null}
                  onAnchorUsed={() => setCommentPanel((panel) => ({ ...panel, anchor: null }))}
                  onClose={closeComments}
                />
              ),
            },
          ],
        }}
      />
    </PageEditorProvider>
  );
}

/**
 * Renders the database row property panel when the underlying page is a
 * database row (`databaseId` is set). Lazy-loads the parent database so
 * the schema is available for the property cells.
 *
 * Returns `null` if this page is a regular doc — leaves the existing
 * editor layout untouched.
 */
function DatabaseRowProperties({ page, readOnly }: { page: Page; readOnly: boolean }) {
  const databaseId = typeof page.databaseId === 'string' ? page.databaseId : null;
  const { data } = useDatabase(databaseId ?? undefined);
  if (!databaseId || !data?.database) return null;
  const row: DatabaseRow = {
    id: page.id,
    workspaceId: page.workspaceId,
    parentId: page.parentId,
    databaseId,
    title: page.title,
    icon: page.icon ?? null,
    cover: page.cover ?? null,
    ownerId: page.ownerId,
    archived: page.archived,
    order: page.order,
    properties: (page.properties ?? {}) as Record<string, PropertyValue>,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
  return (
    <View className="pb-6 border-b border-border/30 mb-4">
      <RowPropertiesPanel database={data.database} row={row} readOnly={readOnly} />
    </View>
  );
}
