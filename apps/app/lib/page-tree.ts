import type { Page } from './types/pages';

export interface TreeNode {
  page: Page;
  children: TreeNode[];
}

export function buildPageTree(pages: Page[]): TreeNode[] {
  const lookup = new Map<string, TreeNode>();
  for (const p of pages) lookup.set(p.id, { page: p, children: [] });
  const roots: TreeNode[] = [];
  for (const p of pages) {
    const node = lookup.get(p.id);
    if (!node) continue;
    if (p.parentId && lookup.has(p.parentId)) {
      lookup.get(p.parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const orderCompare = (a: TreeNode, b: TreeNode) => {
    const ao = a.page.order ?? 0;
    const bo = b.page.order ?? 0;
    if (ao !== bo) return ao - bo;
    return new Date(b.page.updatedAt).getTime() - new Date(a.page.updatedAt).getTime();
  };
  roots.sort(orderCompare);
  for (const n of lookup.values()) n.children.sort(orderCompare);
  return roots;
}
