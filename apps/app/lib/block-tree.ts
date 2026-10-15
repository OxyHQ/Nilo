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

const coordinate = (value: unknown) => (typeof value === 'number' ? value : 0);

/**
 * A canvas page's notes read as a page: top to bottom, then left to right,
 * after anything not in a note. A document's blocks keep their order.
 */
export function inReadingOrder(tree: BlockTreeNode[]): BlockTreeNode[] {
  if (!tree.some((node) => node.block.type === 'canvas_note')) return tree;
  const notes = tree
    .filter((node) => node.block.type === 'canvas_note')
    .sort(
      (a, b) =>
        coordinate(a.block.content.y) - coordinate(b.block.content.y) ||
        coordinate(a.block.content.x) - coordinate(b.block.content.x),
    );
  return [...tree.filter((node) => node.block.type !== 'canvas_note'), ...notes];
}
