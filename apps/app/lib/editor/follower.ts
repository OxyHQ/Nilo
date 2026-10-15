import type { EditorStore } from '@oxy.so/bloom-editor/model';
import { type AppliedOperation, type OrderBook, reconcileOrder, wireToOperations } from './wire';

/**
 * Keeps a read-only page live: applies the transactions others make, in
 * version order, straight to the store. There is nothing to send and nothing
 * local to rebase over (a viewer's own changes, like an opened toggle, stay on
 * the device), so no `SyncSession`; a skipped version or a change that does
 * not apply asks for a reload.
 */
export class RemoteFollower {
  constructor(
    private readonly store: EditorStore,
    /** The page's orders; read on each change (a reload replaces them). */
    private readonly orders: () => OrderBook,
    /** The version the store shows. */
    public version: number,
  ) {}

  receive(event: { version: number; ops: AppliedOperation[] }): 'applied' | 'stale' | 'reload' {
    if (event.version <= this.version) return 'stale';
    if (event.version !== this.version + 1) return 'reload';
    const orders = this.orders();
    const ops = wireToOperations(this.store.doc, event.ops, orders, event.version);
    if (!this.store.dispatch({ ops }, 'remote')) return 'reload';
    this.version = event.version;
    const order = reconcileOrder(this.store.doc, orders);
    if (order.length > 0) this.store.dispatch({ ops: order }, 'remote');
    return 'applied';
  }
}
