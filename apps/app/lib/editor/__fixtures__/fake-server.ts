import { normalizeContent, placeAfter, type BlockType } from '@oxy.so/nilo-contracts';
import type { Block } from '@/lib/types/pages';
import type { AppliedOperation, WireOperation } from '../wire';

/**
 * The transactions endpoint's semantics, in memory: anchors resolved with
 * the shared `placeAfter`, content normalized with the shared contract, the
 * applied operations reported back. Validation the editor never trips
 * (cycles, foreign parents) is left to the API's own tests.
 */
export class FakeServer {
  version = 0;
  private readonly rows = new Map<string, Block>();

  constructor(blocks: readonly Block[] = []) {
    for (const block of blocks) this.rows.set(block.id, { ...block });
  }

  get blocks(): Block[] {
    return [...this.rows.values()].map((row) => ({ ...row }));
  }

  apply(ops: readonly WireOperation[]): { version: number; ops: AppliedOperation[] } {
    const applied: AppliedOperation[] = [];
    const orderAfter = (parent: string | null, afterId: string | null, self: string) => {
      const siblings = this.blocks.filter((b) => b.parentBlockId === parent && b.id !== self);
      const { order, renumbered } = placeAfter(siblings, afterId);
      for (const sibling of renumbered) {
        (this.rows.get(sibling.id) as Block).order = sibling.order;
        applied.push({
          kind: 'reorder',
          id: sibling.id,
          parentBlockId: parent,
          order: sibling.order,
        });
      }
      return order;
    };
    for (const op of ops) {
      if (op.kind === 'insert') {
        const order = orderAfter(op.parentBlockId, op.afterId, op.id);
        const content = normalizeContent(op.type as BlockType, op.content);
        this.rows.set(op.id, {
          id: op.id,
          pageId: 'p',
          parentBlockId: op.parentBlockId,
          type: op.type as Block['type'],
          content,
          order,
          createdAt: '',
          updatedAt: '',
        });
        applied.push({
          kind: 'insert',
          id: op.id,
          parentBlockId: op.parentBlockId,
          type: op.type,
          content,
          order,
        });
      } else if (op.kind === 'update') {
        const row = this.rows.get(op.id) as Block;
        const type = (op.type ?? row.type) as BlockType;
        row.type = type as Block['type'];
        row.content = normalizeContent(type, op.content ?? row.content);
        applied.push({ kind: 'update', id: op.id, type, content: row.content });
      } else if (op.kind === 'move') {
        const order = orderAfter(op.parentBlockId, op.afterId, op.id);
        const row = this.rows.get(op.id) as Block;
        row.parentBlockId = op.parentBlockId;
        row.order = order;
        applied.push({ kind: 'move', id: op.id, parentBlockId: op.parentBlockId, order });
      } else {
        const doomed = new Set([op.id]);
        for (let grew = true; grew; ) {
          grew = false;
          for (const row of this.rows.values()) {
            if (row.parentBlockId && doomed.has(row.parentBlockId) && !doomed.has(row.id)) {
              doomed.add(row.id);
              grew = true;
            }
          }
        }
        for (const id of doomed) this.rows.delete(id);
        applied.push(op);
      }
    }
    this.version += 1;
    return { version: this.version, ops: applied };
  }
}
