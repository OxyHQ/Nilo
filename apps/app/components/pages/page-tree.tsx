import { useNewPageStore } from '@/lib/stores/new-page-store';
import * as React from 'react';
import { View, Pressable } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import {
  ChevronRight,
  ChevronDown,
  Plus,
  FileText,
  FilePlus,
  Pencil,
  Trash2,
} from 'lucide-react-native';
import { Button } from '@oxy.so/bloom/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@oxy.so/bloom/context-menu';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Text } from '@oxy.so/bloom/typography';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { buildPageTree, useDeletePage, usePages } from '@/lib/hooks/use-pages';
import type { Page } from '@/lib/types/pages';

const INDENT_PX = 14;
const ROW_HEIGHT = 28;

/**
 * Vertical tree of pages in the workspace sidebar. Expandable rows, "+" to
 * add a root page, long-press context menu for rename/delete/sub-page.
 *
 * Drag-reorder is intentionally skipped in Phase 1 (see roadmap).
 */
export function PageTree() {
  const pathname = usePathname();
  const { t } = useTranslation();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const { data, isLoading, isError } = usePages(currentWorkspaceId);
  const openNewPage = useNewPageStore((s) => s.open);

  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const tree = React.useMemo(() => {
    if (!data?.pages) return { roots: [], byId: new Map() };
    const visible = data.pages.filter((p) => !p.archived);
    return buildPageTree(visible);
  }, [data?.pages]);

  const handleCreateRoot = React.useCallback(() => {
    if (!currentWorkspaceId) return;
    openNewPage({ workspaceId: currentWorkspaceId, parentId: null });
  }, [openNewPage, currentWorkspaceId]);

  // No workspace selected — render a slim hint so Phase 2 frontend's
  // switcher can drop in above without layout jumps.
  if (!currentWorkspaceId) {
    return (
      <View className="px-3 py-2">
        <Text className="text-xs text-muted-foreground">{t('pages.tree.selectWorkspace')}</Text>
      </View>
    );
  }

  return (
    <View className="flex-1">
      {/* Header */}
      <View className="flex-row items-center justify-between px-3 py-2">
        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('pages.tree.heading')}
        </Text>
        <Button
          appearance="subtle"
          size="xs"
          iconOnly
          onPress={handleCreateRoot}
          accessibilityLabel={t('pages.tree.addPage')}
          renderLeadingIcon={({ size, color }) => <Plus size={size} color={color} />}
        />
      </View>

      {/* Loading */}
      {isLoading ? (
        <View className="px-3 py-2">
          <Text className="text-xs text-muted-foreground">{t('pages.tree.loading')}</Text>
        </View>
      ) : isError ? (
        <View className="px-3 py-2">
          <Text className="text-xs text-destructive">{t('pages.tree.loadFailed')}</Text>
        </View>
      ) : tree.roots.length === 0 ? (
        <EmptyState
          variant="compact"
          // icon: FileText
          title={t('pages.tree.empty')}
        />
      ) : (
        <View className="pb-2">
          {tree.roots.map((page) => (
            <PageRowRecursive
              key={page.id}
              page={page}
              byId={tree.byId}
              depth={0}
              expanded={expanded}
              setExpanded={setExpanded}
              activePath={pathname}
              workspaceId={currentWorkspaceId}
            />
          ))}
        </View>
      )}
    </View>
  );
}

interface PageRowRecursiveProps {
  page: Page;
  byId: Map<string, { page: Page; children: Page[] }>;
  depth: number;
  expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  activePath: string;
  workspaceId: string;
}

function PageRowRecursive({
  page,
  byId,
  depth,
  expanded,
  setExpanded,
  activePath,
  workspaceId,
}: PageRowRecursiveProps) {
  const children = byId.get(page.id)?.children ?? [];
  const isOpen = Boolean(expanded[page.id]);
  return (
    <View>
      <PageRow
        page={page}
        depth={depth}
        hasChildren={children.length > 0}
        isOpen={isOpen}
        onToggle={() => setExpanded((prev) => ({ ...prev, [page.id]: !prev[page.id] }))}
        activePath={activePath}
        workspaceId={workspaceId}
      />
      {isOpen
        ? children.map((child) => (
            <PageRowRecursive
              key={child.id}
              page={child}
              byId={byId}
              depth={depth + 1}
              expanded={expanded}
              setExpanded={setExpanded}
              activePath={activePath}
              workspaceId={workspaceId}
            />
          ))
        : null}
    </View>
  );
}

interface PageRowProps {
  page: Page;
  depth: number;
  hasChildren: boolean;
  isOpen: boolean;
  onToggle: () => void;
  activePath: string;
  workspaceId: string;
}

const PageRow = React.memo(function PageRow({
  page,
  depth,
  hasChildren,
  isOpen,
  onToggle,
  activePath,
  workspaceId,
}: PageRowProps) {
  const router = useRouter();
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const openNewPage = useNewPageStore((s) => s.open);
  const deletePage = useDeletePage();

  const isActive = activePath === `/p/${page.id}`;

  const handleOpen = React.useCallback(() => {
    router.push(`/p/${page.id}`);
  }, [router, page.id]);

  const handleAddChild = React.useCallback(() => {
    openNewPage({ workspaceId, parentId: page.id });
  }, [openNewPage, page.id, workspaceId]);

  const handleDelete = React.useCallback(() => {
    deletePage.mutate({ id: page.id, workspaceId });
  }, [deletePage, page.id, workspaceId]);

  const title = page.title.trim() ? page.title : t('pages.untitled');
  const indent = depth * INDENT_PX;

  return (
    <ContextMenu>
      {/* Long-press on native, right-click on web. */}
      <ContextMenuTrigger asChild>
        <Pressable
          onPress={handleOpen}
          accessibilityLabel={t('pages.openPage', { title })}
          className={
            isActive
              ? 'flex-row items-center bg-muted'
              : 'flex-row items-center hover:bg-muted/60 active:bg-muted/60'
          }
          style={{ paddingLeft: 8 + indent, paddingRight: 8, height: ROW_HEIGHT }}
        >
          {hasChildren ? (
            <Button
              appearance="plain"
              size="xs"
              iconOnly
              stopPropagation
              onPress={onToggle}
              accessibilityLabel={isOpen ? t('pages.collapse') : t('pages.expand')}
              renderLeadingIcon={({ size, color }) =>
                isOpen ? (
                  <ChevronDown size={size} color={color} />
                ) : (
                  <ChevronRight size={size} color={color} />
                )
              }
            />
          ) : (
            <View className="h-6 w-6" />
          )}
          <View className="h-5 w-5 items-center justify-center">
            {page.icon ? (
              <Text className="text-sm leading-5 text-foreground">{page.icon}</Text>
            ) : (
              <FileText size={13} color={colors.mutedForeground} />
            )}
          </View>
          <Text
            className={
              isActive
                ? 'ml-1 flex-1 truncate text-sm font-medium text-foreground'
                : 'ml-1 flex-1 truncate text-sm text-foreground'
            }
            numberOfLines={1}
          >
            {title}
          </Text>
        </Pressable>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          leading={<FilePlus size={16} color={colors.mutedForeground} />}
          onPress={handleAddChild}
        >
          {t('pages.actions.addSubPage')}
        </ContextMenuItem>
        <ContextMenuItem
          leading={<Pencil size={16} color={colors.mutedForeground} />}
          onPress={handleOpen}
        >
          {t('pages.actions.openAndRename')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          leading={<Trash2 size={16} color={colors.mutedForeground} />}
          variant="destructive"
          onPress={handleDelete}
        >
          {t('common.delete')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
