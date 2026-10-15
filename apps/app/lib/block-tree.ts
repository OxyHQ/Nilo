/** The public and history endpoints return the same flat block shape. */
export interface ReadOnlyBlock {
  id: string;
  parentBlockId: string | null;
  type: string;
  content: Record<string, unknown>;
  order: number;
}
export interface BlockTreeNode {
  block: ReadOnlyBlock;
  children: BlockTreeNode[];
}

/** Preserve every unique block, including orphans, and break malformed cycles. */
export function buildBlockTree(blocks: readonly ReadOnlyBlock[]): BlockTreeNode[] {
  const nodes = new Map<string, BlockTreeNode>();
  for (const block of blocks) {
    if (!nodes.has(block.id)) nodes.set(block.id, { block, children: [] });
  }
  const parents = new Map<string, string>();
  const roots: BlockTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.block.parentBlockId;
    const seen = new Set([node.block.id]);
    let ancestor = parent;
    while (ancestor && !seen.has(ancestor)) {
      seen.add(ancestor);
      ancestor = parents.get(ancestor) ?? null;
    }
    if (parent && nodes.has(parent) && !ancestor) {
      parents.set(node.block.id, parent);
      nodes.get(parent)?.children.push(node);
    } else roots.push(node);
  }
  const sort = (siblings: BlockTreeNode[]) => {
    siblings.sort((a, b) => a.block.order - b.block.order || a.block.id.localeCompare(b.block.id));
    for (const node of siblings) sort(node.children);
  };
  sort(roots);
  return roots;
}
