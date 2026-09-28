/**
 * A tldraw sync client in the test process, acting as a tab: it connects to an engine's
 * `/sync/<project>` socket, keeps a store of the canvas schema, and pushes and receives
 * changes through the real sync protocol.
 */
import { randomUUID } from "node:crypto";
import { canvasSchema } from "@unframed/contracts";
import { atom } from "@tldraw/state";
import { Store } from "@tldraw/store";
import { TLSyncClient, type TLPersistentClientSocket, type TLSocketStatusChangeEvent } from "@tldraw/sync-core";
import type { TLRecord } from "@tldraw/tlschema";
import WebSocket from "ws";

// tldraw's send throttle waits for animation frames, which Node does not have.
const globals = globalThis as { requestAnimationFrame?: (cb: (time: number) => void) => unknown; cancelAnimationFrame?: (id: unknown) => void };
globals.requestAnimationFrame ??= (callback) => setTimeout(() => callback(Date.now()), 8);
globals.cancelAnimationFrame ??= (id) => clearTimeout(id as NodeJS.Timeout);

// The protocol types are internal to tldraw; the tests read only `type` and a few fields.
type ClientEvent = { type: string } & Record<string, unknown>;
type ServerEvent = { type: string } & Record<string, any>;

/** One socket at a time, no reconnect: a test decides when to connect again. */
class TestSocket implements TLPersistentClientSocket<ClientEvent, ServerEvent> {
  connectionStatus: "online" | "offline" | "error" = "offline";
  readonly ws: WebSocket;
  readonly received: ServerEvent[] = [];
  closeEvent: { code: number; reason: string } | undefined;
  private readonly messageListeners = new Set<(msg: ServerEvent) => void>();
  private readonly statusListeners = new Set<(event: TLSocketStatusChangeEvent) => void>();

  constructor(url: string, headers: Record<string, string>) {
    this.ws = new WebSocket(url, { headers });
    this.ws.on("open", () => this.setStatus({ status: "online" }));
    this.ws.on("message", (data) => {
      const message = JSON.parse(String(data)) as ServerEvent;
      // The room batches patches and push results into `data` messages.
      if (message.type === "data" && Array.isArray(message.data)) this.received.push(...(message.data as ServerEvent[]));
      else this.received.push(message);
      for (const listener of this.messageListeners) listener(message);
    });
    this.ws.on("close", (code, reason) => {
      this.closeEvent = { code, reason: reason.toString() };
      this.setStatus(code === 4099 ? { status: "error", reason: reason.toString() } : { status: "offline" });
    });
    this.ws.on("error", () => {});
  }

  private setStatus(event: TLSocketStatusChangeEvent) {
    this.connectionStatus = event.status;
    for (const listener of this.statusListeners) listener(event);
  }

  sendMessage(msg: ClientEvent) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  onReceiveMessage(callback: (msg: ServerEvent) => void) {
    this.messageListeners.add(callback);
    return () => this.messageListeners.delete(callback);
  }

  onStatusChange(callback: (event: TLSocketStatusChangeEvent) => void) {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  restart() {}

  close() {
    this.ws.close();
  }
}

export interface SyncTab {
  readonly sessionId: string;
  readonly store: Store<TLRecord>;
  /** Every message the engine sent this tab. */
  readonly received: ServerEvent[];
  /** Resolves once the room answered the connect, or rejects with the close reason. */
  readonly loaded: Promise<void>;
  /** The close the engine sent, once the socket closed. */
  closed(): Promise<{ code: number; reason: string }>;
  /** The document records this tab holds. */
  records(): TLRecord[];
  /** The record, loosely typed so a test can read any field. */
  get(id: string): any;
  /** Puts records as a person's edit, and waits for the engine to commit them. */
  put(records: TLRecord[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  /**
   * Sends records straight to the room, past this tab's own store and its validation.
   * Answers "committed", or the reason the room closed the socket with.
   */
  pushRaw(records: TLRecord[]): Promise<"committed" | { closed: string }>;
  /** Waits until `check` answers something other than `undefined` or `false`. */
  waitFor<T>(check: () => T | undefined | false, timeoutMs?: number): Promise<T>;
  close(): Promise<void>;
}

const until = <T>(check: () => T | undefined | false, timeoutMs: number, what: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      let value: T | undefined | false;
      try {
        value = check();
      } catch {
        value = undefined;
      }
      if (value !== undefined && value !== false) return resolve(value);
      if (Date.now() - started > timeoutMs) return reject(new Error(`Timed out waiting for ${what}`));
      setTimeout(tick, 10);
    };
    tick();
  });

/** Connects a tab to `project` on the engine at `port`. */
export const connectTab = async (
  port: number,
  project: string,
  options: { sessionId?: string; headers?: Record<string, string>; path?: string } = {},
): Promise<SyncTab> => {
  const sessionId = options.sessionId ?? `test-${randomUUID()}`;
  const path = options.path ?? `/sync/${encodeURIComponent(project)}?sessionId=${encodeURIComponent(sessionId)}`;
  const socket = new TestSocket(`ws://127.0.0.1:${port}${path}`, { host: `localhost:${port}`, ...options.headers });
  const store = new Store<TLRecord>({ schema: canvasSchema() as never, props: {} });
  let resolveLoaded!: () => void;
  let rejectLoaded!: (error: Error) => void;
  const loaded = new Promise<void>((resolve, reject) => {
    resolveLoaded = resolve;
    rejectLoaded = reject;
  });
  loaded.catch(() => {});
  const client = new TLSyncClient<TLRecord, Store<TLRecord>>({
    store,
    socket,
    presence: atom("presence", null),
    onLoad: () => resolveLoaded(),
    onSyncError: (reason) => rejectLoaded(new Error(reason)),
  });
  socket.ws.on("close", (code, reason) => rejectLoaded(new Error(`closed ${code} ${reason.toString()}`)));

  const pushResults = () => socket.received.filter((message) => message.type === "push_result").length;
  const commit = async (run: () => void) => {
    const before = pushResults();
    run();
    await until(() => pushResults() > before, 10_000, "the engine to commit a push");
  };

  let rawClock = 1_000_000;
  const pushRaw = async (records: TLRecord[]) => {
    const clientClock = rawClock++;
    socket.sendMessage({ type: "push", clientClock, diff: Object.fromEntries(records.map((record) => [record.id, ["put", record]])) });
    return until<"committed" | { closed: string }>(
      () =>
        socket.received.some((message) => message.type === "push_result" && message.clientClock === clientClock)
          ? "committed"
          : socket.closeEvent && { closed: socket.closeEvent.reason },
      10_000,
      "the room to answer a push",
    );
  };

  const documents = () => store.allRecords().filter((record) => store.scopedTypes.document.has(record.typeName));

  return {
    sessionId,
    store,
    received: socket.received,
    loaded,
    closed: () => until(() => socket.closeEvent, 10_000, "the socket to close"),
    records: documents,
    get: (id) => store.get(id as never),
    put: (records) => commit(() => store.put(records)),
    remove: (ids) => commit(() => store.remove(ids as never)),
    pushRaw,
    waitFor: (check, timeoutMs = 10_000) => until(check, timeoutMs, "a condition on the tab"),
    close: async () => {
      client.close();
      socket.close();
      if (socket.ws.readyState !== WebSocket.CLOSED) {
        await new Promise<void>((resolve) => {
          socket.ws.once("close", () => resolve());
          setTimeout(resolve, 1000);
        });
      }
    },
  };
};
