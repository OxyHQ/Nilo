/**
 * A page's live document on this device (`@oxy.so/bloom-editor/yjs`), kept
 * in step with the server over the page's room and kept on the device.
 *
 * - Opening: what the device kept comes first, so the page shows without a
 *   connection; then the server's state.
 * - Each time the socket connects: join the room, then the Yjs handshake
 *   (`doc:sync`) both ways: the server sends what this device lacks, this
 *   device sends what the server lacks. Work done offline, however long ago,
 *   arrives this way, merged.
 * - While connected: this device's changes go out in small batches
 *   (`doc:update`); everyone else's come in from the room.
 *
 * Every update, from anywhere, is also written to the device (`PageDocStore`);
 * the page is marked synced once the server confirmed all of this device's.
 */
import { MAX_DOC_UPDATE_BYTES } from '@oxy.so/nilo-contracts';
import * as Y from 'yjs';
import type { PageDocStore } from './doc-store-types';

/** How far this device's changes have got. */
export type SyncStatus = 'saved' | 'saving' | 'offline' | 'error';

/** What the session needs of a socket (Socket.IO's client socket). */
export interface SessionSocket {
  readonly connected: boolean;
  emit(event: string, payload: unknown, ack?: (reply: never) => void): unknown;
  on(event: string, listener: (...args: never[]) => void): unknown;
  off(event: string, listener: (...args: never[]) => void): unknown;
}

interface Reply {
  ok: boolean;
  error?: string;
  code?: string;
  update?: ArrayBuffer | Uint8Array;
  stateVector?: ArrayBuffer | Uint8Array;
}

export interface PageSessionOptions {
  pageId: string;
  socket: SessionSocket;
  store: PageDocStore | null;
  readOnly: boolean;
  /** The document has something to show: the device's copy, or the server's state. */
  onReady: (doc: Y.Doc) => void;
  onStatus: (status: SyncStatus) => void;
  /**
   * The server refused this device's change (read-only, a locked page, one in
   * the trash, too large), or — `DEVICE_STORE` — the device could not keep it.
   */
  onRejected: (code: string) => void;
  /** The page cannot be opened: no access, gone, or offline with nothing kept. */
  onUnavailable: (reason: 'forbidden' | 'not_found' | 'offline') => void;
}

/** Changes from the server, and from the device's own copy: neither is sent back. */
const FROM_SERVER = Symbol('server');
const FROM_DEVICE = Symbol('device');
/** How long this device's changes gather before going out together. */
const BATCH_MS = 60;
/** Updates kept separately on the device before they are merged into one. */
const COMPACT_EVERY = 100;

const bytes = (value: ArrayBuffer | Uint8Array | undefined): Uint8Array =>
  value instanceof Uint8Array ? value : new Uint8Array(value ?? new ArrayBuffer(0));

/** Whether an update carries anything (a diff can be empty). */
function hasContent(update: Uint8Array): boolean {
  const { structs, ds } = Y.decodeUpdate(update);
  return structs.length > 0 || ds.clients.size > 0;
}

export class PageSession {
  readonly doc = new Y.Doc();
  private joined = false;
  private ready = false;
  private disposed = false;
  private inflight = 0;
  private batch: Uint8Array[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private appends = 0;
  private status: SyncStatus = 'saved';
  private storeFailed = false;
  private readOnly: boolean;
  private pendingLocal = false;
  private localVersion = 0;
  private persistence: Promise<void> = Promise.resolve();
  private disposal: Promise<number> | null = null;

  constructor(private readonly options: PageSessionOptions) {
    this.readOnly = options.readOnly;
  }

  /**
   * Send this device's changes, or stop sending them (the page turned
   * read-only, or someone who may edit opened it here as well). Turned
   * writable while connected, it syncs again, sending what the server lacks.
   */
  setReadOnly(readOnly: boolean): void {
    if (readOnly === this.readOnly || this.disposed) return;
    this.readOnly = readOnly;
    if (!readOnly && this.joined) this.handshake();
  }

  /** Open the page: the device's copy, then the server whenever the socket is connected. */
  async start(): Promise<void> {
    if (this.disposed) return;
    const { store, pageId, socket } = this.options;
    const kept = await store?.load(pageId).catch((err: unknown) => {
      this.storeFailure(err);
      return null;
    });
    if (this.disposed) return;
    this.pendingLocal = kept?.dirty ?? false;
    if (kept && kept.updates.length > 0) {
      Y.applyUpdate(this.doc, Y.mergeUpdates(kept.updates), FROM_DEVICE);
      this.markReady();
    }
    this.doc.on('update', this.onUpdate);
    socket.on('connect', this.onConnect);
    socket.on('disconnect', this.onDisconnect);
    socket.on('doc:update', this.onRemote);
    if (socket.connected) this.onConnect();
    else if (!this.ready) this.options.onUnavailable('offline');
    else this.setStatus(kept?.dirty ? 'offline' : 'saved');
  }

  /** Close the page; resolves with the size of what the device keeps of it. */
  dispose({ flush = true }: { flush?: boolean } = {}): Promise<number> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    const { socket, pageId, store } = this.options;
    socket.off('connect', this.onConnect);
    socket.off('disconnect', this.onDisconnect);
    socket.off('doc:update', this.onRemote);
    this.doc.off('update', this.onUpdate);
    if (this.batchTimer) clearTimeout(this.batchTimer);
    if (flush) this.flush();
    else this.batch = [];
    socket.emit('page:leave', pageId);
    const state = Y.encodeStateAsUpdate(this.doc);
    this.doc.destroy();
    // A deferred/cancelled opening has no loaded base to compact.
    if (!store || !this.ready) {
      this.disposal = this.persistence.then(() => 0);
    } else {
      this.disposal = this.persist(() => store.compact(pageId, state)).then(
        () => state.byteLength,
        () => 0,
      );
    }
    return this.disposal;
  }

  /** Device writes of this session settle in document order, including closure. */
  private persist(write: () => Promise<void>): Promise<void> {
    const pending = this.persistence.then(write);
    this.persistence = pending.catch(this.storeFailure);
    return pending;
  }

  /** A server confirmation becomes saved only after earlier device writes settle. */
  private confirm(): void {
    const version = this.localVersion;
    void this.persist(async () => {
      if (
        this.storeFailed ||
        version !== this.localVersion ||
        this.inflight !== 0 ||
        this.batch.length !== 0
      )
        return;
      await this.options.store?.markSynced(this.options.pageId);
      if (version !== this.localVersion) return;
      this.pendingLocal = false;
      if (!this.disposed && this.joined) this.setStatus('saved');
    });
  }

  private setStatus(status: SyncStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.options.onStatus(status);
  }

  private markReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.options.onReady(this.doc);
  }

  /**
   * The device could not keep what it was given. The server still has what
   * reached it, but a change made offline would be lost with the app: said
   * once per page, not swallowed.
   */
  private readonly storeFailure = (err: unknown) => {
    console.warn('[page-session] the device could not keep this page', err);
    if (this.storeFailed || this.disposed) return;
    this.storeFailed = true;
    this.options.onRejected('DEVICE_STORE');
  };

  private readonly onUpdate = (update: Uint8Array, origin: unknown) => {
    const { store, pageId } = this.options;
    const { readOnly } = this;
    const local = origin !== FROM_SERVER && origin !== FROM_DEVICE;
    if (local) {
      this.pendingLocal = true;
      this.localVersion += 1;
    }
    if (origin !== FROM_DEVICE && store) {
      void this.persist(() => store.append(pageId, update, local));
      this.appends += 1;
      if (this.appends >= COMPACT_EVERY) {
        this.appends = 0;
        const state = Y.encodeStateAsUpdate(this.doc);
        void this.persist(() => store.compact(pageId, state));
      }
    }
    if (!local || readOnly) return;
    if (!this.joined) {
      // Sent by the handshake once the connection is back.
      this.setStatus('offline');
      return;
    }
    this.batch.push(update);
    this.setStatus('saving');
    this.batchTimer ??= setTimeout(() => this.flush(), BATCH_MS);
  };

  private flush(): void {
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = null;
    if (this.batch.length === 0 || !this.joined) return;
    const update = Y.mergeUpdates(this.batch);
    this.batch = [];
    this.send(update);
  }

  private send(update: Uint8Array): void {
    const { socket, pageId } = this.options;
    if (update.byteLength > MAX_DOC_UPDATE_BYTES) {
      // The server would refuse it: kept on the device, and said.
      this.options.onRejected('UPDATE_TOO_LARGE');
      this.setStatus('error');
      return;
    }
    this.inflight += 1;
    this.setStatus('saving');
    socket.emit('doc:update', { pageId, update }, ((reply: Reply) => {
      this.inflight -= 1;
      if (this.disposed) return;
      if (!reply?.ok) {
        if (
          reply?.code === 'READ_ONLY' ||
          reply?.code === 'PAGE_LOCKED' ||
          reply?.code === 'PAGE_ARCHIVED' ||
          reply?.code === 'UPDATE_TOO_LARGE'
        ) {
          this.options.onRejected(reply.code);
        }
        // Kept on the device: the next handshake sends it again.
        this.setStatus('error');
        return;
      }
      if (this.inflight === 0 && this.batch.length === 0) {
        this.confirm();
      }
    }) as (reply: never) => void);
  }

  /**
   * Someone else's change, from the room. Taken whenever it arrives, the
   * handshake still running included: one broadcast between joining and the
   * handshake's answer may be in neither. Yjs takes an update twice as once,
   * and holds one whose earlier changes have not arrived until they do.
   */
  private readonly onRemote = (payload: { pageId: string; update: ArrayBuffer | Uint8Array }) => {
    if (payload.pageId !== this.options.pageId) return;
    Y.applyUpdate(this.doc, bytes(payload.update), FROM_SERVER);
  };

  private readonly onDisconnect = () => {
    this.joined = false;
    this.inflight = 0;
    // What it held is on the device and in the document: the handshake sends it.
    this.batch = [];
    this.setStatus('offline');
  };

  private readonly onConnect = () => {
    const { socket, pageId } = this.options;
    socket.emit('page:join', pageId, ((ack: Reply) => {
      if (this.disposed) return;
      if (!ack?.ok) {
        if (!this.ready) {
          this.options.onUnavailable(ack?.error === 'Forbidden' ? 'forbidden' : 'not_found');
        }
        this.setStatus('error');
        return;
      }
      this.handshake();
    }) as (reply: never) => void);
  };

  /** The Yjs sync, both ways. */
  private handshake(): void {
    const { socket, pageId } = this.options;
    socket.emit('doc:sync', { pageId, stateVector: Y.encodeStateVector(this.doc) }, ((
      reply: Reply,
    ) => {
      if (this.disposed) return;
      if (!reply?.ok) {
        if (!this.ready) this.options.onUnavailable('not_found');
        this.setStatus('error');
        return;
      }
      Y.applyUpdate(this.doc, bytes(reply.update), FROM_SERVER);
      this.joined = true;
      this.markReady();
      const missing = Y.encodeStateAsUpdate(this.doc, bytes(reply.stateVector));
      if (hasContent(missing)) {
        if (!this.readOnly) this.send(missing);
        else if (this.pendingLocal) {
          // Downloading remote state is not an acknowledgement of a local draft.
          this.options.onRejected('READ_ONLY');
          this.setStatus('error');
        } else this.setStatus('saved');
      } else this.confirm();
      this.flush();
    }) as (reply: never) => void);
  }
}
