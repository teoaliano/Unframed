import { reconnectDelay } from "@unframed/domain";
import * as syncCore from "@tldraw/sync-core";
import type { TLPersistentClientSocket, TLSocketStatusChangeEvent } from "@tldraw/sync-core";

/** tldraw's close code for a refusal the tab should not retry, such as an unknown project. */
const SYNC_ERROR_CLOSE = 4099;

// `chunk` is exported at runtime but left out of tldraw's public types.
const chunk = (syncCore as unknown as { chunk: (message: string) => string[] }).chunk;

type Message = { type?: string; data?: unknown } & Record<string, unknown>;

export interface SyncSocketHooks {
  /** The socket went up or down. A refusal (4099) is not "down": nothing is reconnecting. */
  readonly onHealth: (health: "up" | "down") => void;
  /** The engine refused this canvas for good, with its reason. */
  readonly onRefused: (reason: string) => void;
}

/**
 * The canvas sync socket to `/sync/<project>`. It reconnects by itself with backoff from
 * 1 second, doubling, capped at 10 seconds, and starts again at 1 second after a
 * connection opens. tldraw's own socket retries on a different schedule.
 */
export class SyncSocket implements TLPersistentClientSocket<Message, Message> {
  connectionStatus: "online" | "offline" | "error" = "offline";
  private ws: WebSocket | null = null;
  private failedAttempts = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  /** Pushes sent and not yet answered by the room. */
  private pending = 0;
  private readonly messageListeners = new Set<(message: Message) => void>();
  private readonly statusListeners = new Set<(event: TLSocketStatusChangeEvent) => void>();
  private readonly url: string;
  private readonly hooks: SyncSocketHooks;

  constructor(url: string, hooks: SyncSocketHooks) {
    this.url = url;
    this.hooks = hooks;
    this.open();
  }

  private setStatus(event: TLSocketStatusChangeEvent) {
    this.connectionStatus = event.status;
    for (const listener of this.statusListeners) listener(event);
  }

  private open() {
    if (this.disposed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.failedAttempts = 0;
      this.hooks.onHealth("up");
      this.setStatus({ status: "online" });
    };
    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      let message: Message;
      try {
        message = JSON.parse(String(event.data)) as Message;
      } catch {
        this.restart();
        return;
      }
      const answered =
        message.type === "push_result"
          ? 1
          : message.type === "data" && Array.isArray(message.data)
            ? message.data.filter((each) => (each as Message)?.type === "push_result").length
            : 0;
      this.pending = Math.max(0, this.pending - answered);
      for (const listener of this.messageListeners) listener(message);
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.pending = 0;
      if (event.code === SYNC_ERROR_CLOSE) {
        this.hooks.onHealth("up");
        this.setStatus({ status: "error", reason: event.reason });
        this.hooks.onRefused(event.reason);
        return;
      }
      this.hooks.onHealth("down");
      if (this.connectionStatus !== "offline") this.setStatus({ status: "offline" });
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.disposed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.open(), reconnectDelay(this.failedAttempts++));
  }

  sendMessage(message: Message) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (message.type === "push") this.pending++;
    for (const part of chunk(JSON.stringify(message))) ws.send(part);
  }

  onReceiveMessage(callback: (message: Message) => void) {
    this.messageListeners.add(callback);
    return () => void this.messageListeners.delete(callback);
  }

  onStatusChange(callback: (event: TLSocketStatusChangeEvent) => void) {
    this.statusListeners.add(callback);
    return () => void this.statusListeners.delete(callback);
  }

  /** Drops the current socket and connects again right away. */
  restart() {
    const ws = this.ws;
    this.ws = null;
    this.pending = 0;
    ws?.close();
    if (this.connectionStatus !== "offline") this.setStatus({ status: "offline" });
    clearTimeout(this.timer);
    this.open();
  }

  /** Resolves once every push sent has been answered, or after `timeoutMs`. */
  settled(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const started = Date.now();
      const check = () => {
        if (this.pending === 0 || this.ws === null || Date.now() - started >= timeoutMs) return resolve();
        setTimeout(check, 25);
      };
      // Let tldraw's per-frame send throttle flush first.
      setTimeout(check, 50);
    });
  }

  close() {
    this.disposed = true;
    clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}
