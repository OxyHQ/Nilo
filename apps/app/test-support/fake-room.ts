/**
 * The API's page room as a session sees it, for tests of the editing
 * session (`lib/editor/page-session.ts`) and of what shares it
 * (`lib/editor/shared-sessions.ts`): joining, the Yjs handshake, broadcasts
 * to every other socket in the room, and refusals.
 */
import * as Y from 'yjs';

type Handler = (...args: never[]) => void;

/** The API's page room, as far as a session sees it. */
export class FakeServer {
  readonly doc = new Y.Doc();
  readonly sockets = new Set<FakeSocket>();
  forbidden = false;
  /**
   * Runs while a handshake is being answered, after the state it answers
   * with was read: a change landing in that window.
   */
  duringSync: (() => void) | null = null;
  readOnly = new Set<FakeSocket>();
  locked = false;

  handle(from: FakeSocket, event: string, payload: unknown, ack?: (reply: unknown) => void) {
    const reply = ack ?? (() => {});
    if (event === 'page:join')
      return reply(this.forbidden ? { ok: false, error: 'Forbidden' } : { ok: true });
    if (event === 'page:leave' || event === 'page:focus') return;
    const { stateVector, update } = payload as { stateVector?: Uint8Array; update?: Uint8Array };
    if (event === 'doc:sync' && this.duringSync) {
      const answer = {
        ok: true,
        update: Y.encodeStateAsUpdate(this.doc, stateVector),
        stateVector: Y.encodeStateVector(this.doc),
      };
      const during = this.duringSync;
      this.duringSync = null;
      during();
      // The answer leaves after the broadcast, as it can over the network.
      return setTimeout(() => reply(answer), 20);
    }
    if (event === 'doc:sync') {
      return reply({
        ok: true,
        update: Y.encodeStateAsUpdate(this.doc, stateVector),
        stateVector: Y.encodeStateVector(this.doc),
      });
    }
    if (event === 'doc:update' && update) {
      if (this.readOnly.has(from)) return reply({ ok: false, code: 'READ_ONLY' });
      if (this.locked) return reply({ ok: false, code: 'PAGE_LOCKED' });
      Y.applyUpdate(this.doc, update);
      for (const other of this.sockets) {
        if (other !== from && other.connected)
          other.deliver('doc:update', { pageId: 'page', update });
      }
      return reply({ ok: true });
    }
  }
}

export class FakeSocket {
  connected = false;
  private readonly handlers = new Map<string, Set<Handler>>();
  constructor(private readonly server: FakeServer) {
    server.sockets.add(this);
  }
  on(event: string, handler: Handler) {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
  }
  off(event: string, handler: Handler) {
    this.handlers.get(event)?.delete(handler);
  }
  /** Every event this socket sent, in order. */
  readonly sent: string[] = [];
  emit(event: string, payload: unknown, ack?: (reply: never) => void) {
    if (!this.connected) return;
    this.sent.push(event);
    // Over the network: never synchronous.
    queueMicrotask(() => this.server.handle(this, event, payload, ack as (reply: unknown) => void));
  }
  deliver(event: string, payload: unknown) {
    queueMicrotask(() => {
      for (const handler of this.handlers.get(event) ?? [])
        (handler as (p: unknown) => void)(payload);
    });
  }
  connect() {
    this.connected = true;
    for (const handler of this.handlers.get('connect') ?? []) (handler as () => void)();
  }
  disconnect() {
    this.connected = false;
    for (const handler of this.handlers.get('disconnect') ?? []) (handler as () => void)();
  }
}

export const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 70));
};
