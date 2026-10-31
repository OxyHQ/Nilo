/** Identity of the currently bound product transport, without exposing credentials. */
let version = 0;
const listeners = new Set<() => void>();

export function apiSessionContextVersion(): number {
  return version;
}

export function onApiSessionContextChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function advanceApiSessionContext(): void {
  version += 1;
  for (const listener of listeners) listener();
}
