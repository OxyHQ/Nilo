import type { ReactNode } from 'react';
import { RiTableLine } from '@oxy.so/bloom/icons/RiTableLine';
import type { SidebarTreeItem } from '@oxy.so/bloom/sidebar';
import { IconDisplay } from '@/components/page-chrome/icon-display';
import { buildPageTree, type TreeNode } from '@/lib/page-tree';
import type { Database } from '@/lib/types/databases';
import type { Page } from '@/lib/types/pages';

/** What every page row of one tree shares. */
export interface PageRowOptions {
  /**
   * Prefix for the rows' keys: a page listed in two places (a favourite and its
   * own section) needs a key per place. Empty for the trees pages move in.
   */
  keyPrefix: string;
  /** The open route, so the open page is selected wherever it is listed. */
  activePath: string;
  /** Which rows are open, by key. */
  expanded: Readonly<Record<string, boolean>>;
  onExpandedChange: (key: string, open: boolean) => void;
  draggable: boolean;
  untitled: string;
  /** Under an open page with nothing in it. */
  emptyLabel: string;
  /** The row's add and more buttons; absent where the reader cannot edit. */
  actions?: (page: Page) => ReactNode;
}

/** A tree of pages as sidebar rows: icon, title, link, children, actions. */
export function pageRows(pages: readonly Page[], options: PageRowOptions): SidebarTreeItem[] {
  return buildPageTree([...pages]).map((node) => pageRow(node, options));
}

function pageRow(node: TreeNode, options: PageRowOptions): SidebarTreeItem {
  const { page } = node;
  const key = `${options.keyPrefix}${page.id}`;
  const href = `/p/${page.id}`;
  return {
    key,
    label: page.title.trim() || options.untitled,
    leading: <IconDisplay value={page.icon} size={15} showPlaceholder pageId={page.id} />,
    href,
    selected: options.activePath === href,
    items: node.children.map((child) => pageRow(child, options)),
    // Every page can hold pages: the disclosure says what one holds, even nothing.
    expandable: true,
    emptyLabel: options.emptyLabel,
    open: options.expanded[key] === true,
    onOpenChange: (open) => options.onExpandedChange(key, open),
    actions: options.actions?.(page),
    actionsVisibility: 'hover',
    draggable: options.draggable,
  };
}

/** Standalone databases, after a section's pages: they open, they do not move. */
export function databaseRows(
  databases: readonly Database[],
  activePath: string,
  untitled: string,
): SidebarTreeItem[] {
  return databases.map((database) => {
    const href = `/db/${database.id}`;
    return {
      key: `db:${database.id}`,
      label: database.name || untitled,
      ...(database.icon
        ? { leading: <IconDisplay value={database.icon} size={15} /> }
        : { icon: RiTableLine }),
      href,
      selected: activePath === href,
      droppable: false,
    };
  });
}
