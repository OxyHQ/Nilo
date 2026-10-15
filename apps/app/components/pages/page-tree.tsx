import * as React from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { ChevronRight, ChevronDown, Plus, FileText } from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { buildPageTree, useCreatePage, useDeletePage, usePages } from '@/lib/hooks/use-pages';
import type { Page } from '@/lib/types/pages';
import * as DropdownMenu from '@/components/ui/dropdown-menu';

const INDENT_PX = 14;
const ROW_HEIGHT = 28;

/**
 * Vertical tree of pages in the workspace sidebar. Expandable rows, "+" to
 * add a root page, long-press context menu for rename/delete/sub-page.
 *
 * Drag-reorder is intentionally skipped in Phase 1 (see roadmap).
 */
export function PageTree() {
  const router = useRouter();
  const pathname = usePathname();
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const { data, isLoading, isError } = usePages(currentWorkspaceId);
  const createPage = useCreatePage();

  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const tree = React.useMemo(() => {
    if (!data?.pages) return { roots: [], byId: new Map() };
    const visible = data.pages.filter((p) => !p.archived);
    return buildPageTree(visible);
  }, [data?.pages]);

  const handleCreateRoot = React.useCallback(async () => {
    if (!currentWorkspaceId) return;
    try {
      const page = await createPage.mutateAsync({
        workspaceId: currentWorkspaceId,
        parentId: null,
        title: '',
      });
      router.push(`/p/${page.id}`);
    } catch {
      // Mutation errors surface via TanStack Query state; no silent catch needed beyond no-op.
    }
  }, [createPage, currentWorkspaceId, router]);

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
        <Pressable
          onPress={handleCreateRoot}
          accessibilityLabel={t('pages.tree.addPage')}
          className="h-6 w-6 items-center justify-center rounded-md hover:bg-muted active:bg-muted"
          disabled={createPage.isPending}
        >
          {createPage.isPending ? (
            <ActivityIndicator size="small" color={colors.mutedForeground} />
          ) : (
            <Plus size={14} color={colors.mutedForeground} />
          )}
        </Pressable>
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
        <View className="px-3 py-3">
          <Text className="text-xs text-muted-foreground">{t('pages.tree.empty')}</Text>
        </View>
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
  const createPage = useCreatePage();
  const deletePage = useDeletePage();

  const isActive = activePath === `/p/${page.id}`;

  const handleOpen = React.useCallback(() => {
    router.push(`/p/${page.id}`);
  }, [router, page.id]);

  const handleAddChild = React.useCallback(async () => {
    try {
      const child = await createPage.mutateAsync({
        workspaceId,
        parentId: page.id,
        title: '',
      });
      router.push(`/p/${child.id}`);
    } catch {
      // Mutation surfaces error via state; nothing else to do.
    }
  }, [createPage, page.id, router, workspaceId]);

  const handleDelete = React.useCallback(() => {
    deletePage.mutate({ id: page.id, workspaceId });
  }, [deletePage, page.id, workspaceId]);

  const title = page.title.trim() ? page.title : t('pages.untitled');
  const indent = depth * INDENT_PX;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <Pressable
          onPress={handleOpen}
          onLongPress={() => {
            // Long-press opens the dropdown via zeego on native; on web,
            // users can right-click the trigger.
          }}
          accessibilityLabel={t('pages.openPage', { title })}
          className={
            isActive
              ? 'flex-row items-center bg-muted'
              : 'flex-row items-center hover:bg-muted/60 active:bg-muted/60'
          }
          style={{ paddingLeft: 8 + indent, paddingRight: 8, height: ROW_HEIGHT }}
        >
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              if (hasChildren) onToggle();
            }}
            accessibilityLabel={isOpen ? t('pages.collapse') : t('pages.expand')}
            className="h-5 w-5 items-center justify-center rounded"
            disabled={!hasChildren}
          >
            {hasChildren ? (
              isOpen ? (
                <ChevronDown size={12} color={colors.mutedForeground} />
              ) : (
                <ChevronRight size={12} color={colors.mutedForeground} />
              )
            ) : null}
          </Pressable>
          <View className="h-5 w-5 items-center justify-center">
            {page.icon ? (
              <Text className="text-sm leading-5">{page.icon}</Text>
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
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Item key="add-sub" onSelect={handleAddChild}>
          <DropdownMenu.ItemIcon ios={{ name: 'doc' }} />
          <DropdownMenu.ItemTitle>{t('pages.actions.addSubPage')}</DropdownMenu.ItemTitle>
        </DropdownMenu.Item>
        <DropdownMenu.Item key="rename" onSelect={handleOpen}>
          <DropdownMenu.ItemIcon ios={{ name: 'pencil' }} />
          <DropdownMenu.ItemTitle>{t('pages.actions.openAndRename')}</DropdownMenu.ItemTitle>
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item key="delete" destructive onSelect={handleDelete}>
          <DropdownMenu.ItemIcon ios={{ name: 'trash' }} />
          <DropdownMenu.ItemTitle>{t('common.delete')}</DropdownMenu.ItemTitle>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
});
