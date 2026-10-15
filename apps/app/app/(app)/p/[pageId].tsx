import * as React from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import axios from 'axios';
import { Lock, MessageCircle } from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import {
  PageEditorProvider,
  PageEditorToolbar,
  usePageEditorContext,
} from '@/components/page-editor/page-editor-context';
import { PageEditor } from '@/components/page-editor/page-editor';
import { ShareButton } from '@/components/sharing';
import { CommentPanel } from '@/components/comments/comment-panel';
import { PageChrome, PageHeader } from '@/components/page-chrome';
import { RowPropertiesPanel } from '@/components/database/row-properties-panel';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { usePage } from '@/lib/hooks/use-pages';
import { usePageComments } from '@/lib/hooks/use-comments';
import { useDatabase } from '@/lib/hooks/use-databases';
import { useTrackRecentPage } from '@/lib/hooks/use-track-recent-page';
import { hasRole } from '@/lib/hooks/workspace-roles';
import type { DatabaseRow, PropertyValue } from '@/lib/types/databases';
import type { Page } from '@/lib/types/pages';

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
        <Text className="text-base text-muted-foreground">{t('pages.noneSelected')}</Text>
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
  const { data: commentsData } = usePageComments(pageId, false);
  const role = data?.role;
  useTrackRecentPage(pageId);

  const [commentPanel, setCommentPanel] = React.useState<{
    open: boolean;
    focusedBlockId: string | null;
  }>({ open: false, focusedBlockId: null });

  React.useEffect(() => {
    if (openComments) setCommentPanel({ open: true, focusedBlockId: blockId ?? null });
  }, [openComments, blockId]);

  const openCommentCount = React.useMemo(() => {
    const comments = commentsData?.comments ?? [];
    return comments.filter((c) => c.parentCommentId === null && c.resolvedAt === null).length;
  }, [commentsData?.comments]);

  const handleOpenPanel = (focusedBlockId: string | null = null) => {
    setCommentPanel({ open: true, focusedBlockId });
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={colors.mutedForeground} />
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
        <View className="max-w-md items-center gap-3">
          <Text className="text-base text-foreground">{message}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('pages.backToWorkspace')}
            onPress={() => router.replace('/(app)')}
            className="rounded-md bg-primary px-4 py-2"
          >
            <Text className="text-sm font-medium text-primary-foreground">
              {t('pages.backToWorkspace')}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const page = data.page;
  const canEdit = hasRole(role, 'editor');

  const rightHeader = (
    <View className="flex-row items-center gap-2">
      {page.restricted ? (
        <View accessible accessibilityLabel={t('pages.restricted')}>
          <Lock size={14} color={colors.mutedForeground} />
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => handleOpenPanel(null)}
        accessibilityLabel={t('pages.comments.open')}
        className="flex-row items-center gap-1.5 rounded-md px-2 py-1 hover:bg-muted"
      >
        <MessageCircle size={14} color={colors.foreground} />
        <Text className="text-xs font-medium text-foreground">
          {openCommentCount > 0 ? openCommentCount : ''} {t('pages.comments.label')}
        </Text>
      </Pressable>
      <ShareButton pageId={page.id} />
    </View>
  );

  return (
    <PageEditorProvider pageId={pageId} readOnly={!canEdit}>
      <PageChrome page={page} readOnly={!canEdit} rightHeader={rightHeader}>
        <View className="flex-1 flex-row">
          <EditorScrollView>
            <PageHeader page={page} readOnly={!canEdit} />
            <View className="px-6 md:px-10 max-w-3xl w-full mx-auto pt-4">
              <DatabaseRowProperties page={page} readOnly={!canEdit} />
              <PageEditor
                pageId={page.id}
                focusedBlockId={blockId}
                readOnly={!canEdit}
                onOpenBlockComments={(blockId) => handleOpenPanel(blockId)}
              />
            </View>
          </EditorScrollView>

          <CommentPanel
            canComment={hasRole(role, 'commenter')}
            pageId={page.id}
            workspaceId={page.workspaceId}
            open={commentPanel.open}
            focusedBlockId={commentPanel.focusedBlockId}
            onClose={() => setCommentPanel({ open: false, focusedBlockId: null })}
          />
        </View>
        <PageEditorToolbar readOnly={!canEdit} />
      </PageChrome>
    </PageEditorProvider>
  );
}

/** The inset follows the toolbar's measured height, including its link form. */
function EditorScrollView({ children }: { children: React.ReactNode }) {
  const { toolbarHeight } = usePageEditorContext();
  if (Platform.OS === 'web') {
    return (
      <ScrollView
        className="flex-1"
        contentContainerClassName="pb-12"
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    );
  }
  return (
    <KeyboardAwareScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: 48 + toolbarHeight }}
      bottomOffset={toolbarHeight}
      extraKeyboardSpace={toolbarHeight}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </KeyboardAwareScrollView>
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
