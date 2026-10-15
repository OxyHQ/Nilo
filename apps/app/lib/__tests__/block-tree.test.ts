import { buildBlockTree, type ReadOnlyBlock, type BlockTreeNode } from '../block-tree';
const block = (id: string, parentBlockId: string | null, order = 0): ReadOnlyBlock => ({
  id,
  parentBlockId,
  order,
  type: 'paragraph',
  content: { text: id },
});
const flatten = (nodes: BlockTreeNode[]): string[] =>
  nodes.flatMap((node) => [node.block.id, ...flatten(node.children)]);

describe('read-only block tree', () => {
  it('nests children arriving before parents and sorts siblings without mutating input', () => {
    const blocks = [
      block('second', 'root', 9),
      block('grandchild', 'first'),
      block('root', null),
      block('first', 'root', 2),
    ];
    const before = JSON.stringify(blocks);
    const tree = buildBlockTree(blocks);
    expect(flatten(tree)).toEqual(['root', 'first', 'grandchild', 'second']);
    expect(tree[0].children[0].children[0].block.id).toBe('grandchild');
    expect(JSON.stringify(blocks)).toBe(before);
  });
  it('promotes orphaned blocks and preserves their descendants', () => {
    const tree = buildBlockTree([block('child', 'orphan'), block('orphan', 'missing')]);
    expect(flatten(tree)).toEqual(['orphan', 'child']);
  });
  it('breaks cycles and self-parenting while keeping each unique block exactly once', () => {
    const tree = buildBlockTree([
      block('a', 'b'),
      block('b', 'c'),
      block('c', 'a'),
      block('self', 'self'),
      block('a', null),
    ]);
    expect(flatten(tree).sort()).toEqual(['a', 'b', 'c', 'self']);
  });
  it('has deterministic tie ordering and handles empty snapshots', () => {
    expect(buildBlockTree([])).toEqual([]);
    expect(flatten(buildBlockTree([block('b', null), block('a', null)]))).toEqual(['a', 'b']);
  });
});
