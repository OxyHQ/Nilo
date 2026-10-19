import * as React from 'react';
import { View } from 'react-native';
import { usePathname } from 'expo-router';
import { buildPageTree, type TreeNode } from '@/lib/page-tree';
import { Text } from '@oxy.so/bloom/typography';
import { useUpdatePage } from '@/lib/hooks/use-pages';
import type { Page } from '@/lib/types/pages';
import { type DropPosition, planSidebarDrop } from '@/lib/sidebar-drop';
import { SidebarPageRow } from './page-row';

interface DragMutation {
  sourceId: string;
  targetId: string;
  position: DropPosition;
}

interface SidebarPageTreeProps {
  /** Flat list of pages to organize into a tree. */
  pages: Page[];
  readOnly?: boolean;
  /** Workspace context (used for invalidation by mutations). */
  workspaceId: string;
  /** Empty-state copy when no pages match. */
  emptyText?: string;
  /** Whether drag-to-reorder is enabled for this tree. */
  enableDrag?: boolean;
  /**
   * Where this tree's top-level pages live (a teamspace, or null for
   * private): a page dropped at its top level moves there.
   */
  place?: { teamspaceId: string | null };
}

/**
 * Renders an indented tree of page rows from a filtered list of pages. Handles
 * local expand/collapse state and resolves drops on its rows to PATCH calls
 * against the pages API (`planSidebarDrop`).
 */
export function SidebarPageTree({
  pages,
  workspaceId,
  emptyText,
  enableDrag = true,
  readOnly = false,
  place,
}: SidebarPageTreeProps) {
  const pathname = usePathname();
  const updatePage = useUpdatePage();
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const roots = React.useMemo(() => buildPageTree(pages), [pages]);

  // A drop on one of this tree's rows, wherever the page came from.
  const handleCommit = React.useCallback(
    ({ sourceId, targetId, position }: DragMutation) => {
      const moves = planSidebarDrop({ pages, sourceId, targetId, position, place });
      for (const move of moves ?? []) updatePage.mutate({ id: move.id, ...move.patch });
    },
    [pages, place, updatePage],
  );

  if (pages.length === 0) {
    if (!emptyText) return null;
    return (
      <View className="px-4 py-1.5">
        <Text className="text-xs text-muted-foreground">{emptyText}</Text>
      </View>
    );
  }

  return (
    <View>
      {roots.map((node) => (
        <TreeNodeRow
          key={node.page.id}
          node={node}
          depth={0}
          activePath={pathname}
          workspaceId={workspaceId}
          expanded={expanded}
          setExpanded={setExpanded}
          readOnly={readOnly}
          enableDrag={enableDrag && !readOnly}
          onCommit={handleCommit}
        />
      ))}
    </View>
  );
}

interface TreeNodeRowProps {
  node: TreeNode;
  depth: number;
  activePath: string;
  workspaceId: string;
  expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  enableDrag: boolean;
  readOnly: boolean;
  onCommit: (mutation: DragMutation) => void;
}

function TreeNodeRow({
  node,
  depth,
  activePath,
  workspaceId,
  expanded,
  setExpanded,
  enableDrag,
  readOnly,
  onCommit,
}: TreeNodeRowProps) {
  const isOpen = Boolean(expanded[node.page.id]);
  const hasChildren = node.children.length > 0;
  const isActive = activePath === `/p/${node.page.id}`;

  const handleDrop = React.useCallback(
    (sourceId: string, position: DropPosition) => {
      onCommit({ sourceId, targetId: node.page.id, position });
    },
    [node.page.id, onCommit],
  );

  return (
    <View>
      <SidebarPageRow
        page={node.page}
        depth={depth}
        hasChildren={hasChildren}
        isOpen={isOpen}
        onToggle={() =>
          setExpanded((prev) => ({
            ...prev,
            [node.page.id]: !prev[node.page.id],
          }))
        }
        isActive={isActive}
        workspaceId={workspaceId}
        readOnly={readOnly}
        enableDrag={enableDrag}
        onDrop={handleDrop}
      />
      {isOpen
        ? node.children.map((child) => (
            <TreeNodeRow
              key={child.page.id}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              workspaceId={workspaceId}
              expanded={expanded}
              setExpanded={setExpanded}
              readOnly={readOnly}
              enableDrag={enableDrag && !readOnly}
              onCommit={onCommit}
            />
          ))
        : null}
    </View>
  );
}
