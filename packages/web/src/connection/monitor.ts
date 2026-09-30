import { closeToast, showError } from "../toasts.tsx";

export const CONNECTION_LOST_MESSAGE = "Lost the connection to the local server. Reconnecting…";
const TOAST_ID = "connection-lost";
/** A drop shorter than this shows nothing. */
export const DISCONNECT_NOTICE_DELAY_MS = 2000;

export type SocketHealth = "up" | "down";

/**
 * Watches both engine sockets, the RPC socket and the canvas sync socket, and drives the
 * connection-lost notice. This is the only place that notice is defined: it appears once
 * either socket has been down for 2 seconds and closes by itself once both are up again.
 */
export class ConnectionMonitor {
  private rpc: SocketHealth = "down";
  /** No canvas open counts as up: there is no sync socket to lose. */
  private sync: SocketHealth = "up";
  private timer: ReturnType<typeof setTimeout> | undefined;
  private shown = false;

  constructor() {
    this.update();
  }

  setRpc(health: SocketHealth): void {
    this.rpc = health;
    this.update();
  }

  setSync(health: SocketHealth): void {
    this.sync = health;
    this.update();
  }

  private update(): void {
    const down = this.rpc === "down" || this.sync === "down";
    if (!down) {
      clearTimeout(this.timer);
      this.timer = undefined;
      if (this.shown) closeToast(TOAST_ID);
      this.shown = false;
      return;
    }
    if (this.timer !== undefined || this.shown) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.shown = true;
      showError(CONNECTION_LOST_MESSAGE, { id: TOAST_ID, sticky: true });
    }, DISCONNECT_NOTICE_DELAY_MS);
  }
}

export const connectionMonitor = new ConnectionMonitor();
