import type { CommandContext, EditorStore, Transaction } from '@oxy.so/bloom-editor';

/** Run one structural edit from a block's own controls, as its own undo step. */
export function runCommand(
  store: EditorStore,
  command: (ctx: CommandContext) => Transaction | null,
): boolean {
  store.sealHistory();
  return store.run(command);
}
