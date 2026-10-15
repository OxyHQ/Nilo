import { type BlockTreeNode, inReadingOrder } from '@/lib/block-tree';

const node = (id: string, type: string, content: Record<string, unknown> = {}): BlockTreeNode => ({
  block: { id, parentBlockId: null, type, content, order: 0 } as BlockTreeNode['block'],
  children: [],
});

it("reads a canvas page's notes top to bottom, then left to right", () => {
  const tree = [
    node('right', 'canvas_note', { x: 500, y: 0 }),
    node('below', 'canvas_note', { x: 0, y: 400 }),
    node('left', 'canvas_note', { x: 0, y: 0 }),
  ];
  expect(inReadingOrder(tree).map((n) => n.block.id)).toEqual(['left', 'right', 'below']);
});

it('keeps a document in its order, and anything outside a note first', () => {
  const doc = [node('b', 'paragraph'), node('a', 'heading_1')];
  expect(inReadingOrder(doc)).toBe(doc);
  const mixed = [node('n', 'canvas_note', { x: 0, y: 0 }), node('p', 'paragraph')];
  expect(inReadingOrder(mixed).map((n) => n.block.id)).toEqual(['p', 'n']);
});
