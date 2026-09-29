/**
 * The settings dialog's app-level state (spec 10): whether it is open, the live settings,
 * the key status, and the one pending OpenRouter connection with its poll. It lives outside
 * the dialog so that closing the dialog never abandons a connection.
 */
import { UnframedError, type KeyStatus, type Settings } from "@unframed/contracts";
import { OAUTH_ATTEMPT_MS, OAUTH_NOTHING_CAME_BACK } from "@unframed/domain";
import { useSyncExternalStore } from "react";
import type { EngineConnection } from "../rpc/engine.ts";
import { showError, showNotice } from "../toasts.tsx";

export const POLL_MS = 1500;
export const CONNECTED_MESSAGE = "Connected to OpenRouter.";
export const CONNECTION_LOST = "That connection was lost before it finished. Try connecting again.";
export const CONNECT_FAILED = "Connecting failed. Try again.";

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

export interface PendingConnection {
  readonly since: number;
  readonly authorizeUrl: string;
  /** Whether a key existed when it started: a reconnect keeps the dialog open. */
  readonly hadKey: boolean;
}

export interface SettingsUiState {
  /** `undefined` until the first answer of `settings.subscribe`. */
  readonly settings: Settings | undefined;
  readonly open: boolean;
  /** The latest key status fetched; `undefined` when not fetched or it failed. */
  readonly keyStatus: KeyStatus | undefined;
  readonly connection: PendingConnection | undefined;
  /** Between a Connect click and the engine's answer. */
  readonly starting: boolean;
  /** A report for the dialog's error banner, with a counter so the same words twice still show. */
  readonly report: { readonly id: number; readonly message: string } | undefined;
  /** Counts Connect clicks and reconnects that landed: the dialog clears its key draft and banner on each. */
  readonly resets: number;
}

export class SettingsUi {
  private state: SettingsUiState = { settings: undefined, open: false, keyStatus: undefined, connection: undefined, starting: false, report: undefined, resets: 0 };
  private readonly listeners = new Set<() => void>();
  private readonly engine: EngineConnection;
  private poller: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  /** Bumped by every key status fetch, so only the latest of overlapping fetches is shown. */
  private statusFetch = 0;
  private cancelling: Promise<void> = Promise.resolve();
  private stopSettings: (() => void) | undefined;

  constructor(engine: EngineConnection) {
    this.engine = engine;
  }

  current = (): SettingsUiState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private set(patch: Partial<SettingsUiState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Follows `settings.subscribe`; the first answer without a key opens the dialog. */
  start(): () => void {
    if (this.stopSettings) return this.stopSettings;
    let first = true;
    const stop = this.engine.subscribe("settings.subscribe", undefined, (settings) => {
      const opens = first && !settings.hasKey;
      first = false;
      this.set(opens ? { settings, open: true } : { settings });
    });
    this.stopSettings = () => {
      stop();
      this.stopSettings = undefined;
    };
    return this.stopSettings;
  }

  setSettings(settings: Settings) {
    this.set({ settings });
  }

  open() {
    this.set({ open: true, report: undefined });
  }

  close() {
    this.set({ open: false, report: undefined });
  }

  /** The dialog banner when the dialog is open, else a toast. */
  report(message: string) {
    if (this.state.open) this.set({ report: { id: (this.state.report?.id ?? 0) + 1, message } });
    else showError(message);
  }

  clearKeyStatus() {
    this.statusFetch++;
    this.set({ keyStatus: undefined });
  }

  async fetchKeyStatus(): Promise<void> {
    const fetch = ++this.statusFetch;
    const status = await this.engine.call("oauth.status").catch(() => undefined);
    if (fetch === this.statusFetch) this.set({ keyStatus: status });
  }

  /**
   * Opens a blank tab inside the click (a popup opened after an await is blocked by Safari
   * and Firefox), then points it at OpenRouter once the engine has an attempt.
   */
  connect() {
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    const hadKey = this.state.settings?.hasKey === true;
    this.stopPolling();
    this.set({ connection: undefined, starting: true, report: undefined, resets: this.state.resets + 1 });
    void (async () => {
      // A cancel the engine served second would wipe the attempt this starts.
      await this.cancelling;
      try {
        const { authorizeUrl } = await this.engine.call("oauth.start");
        if (tab) tab.location.href = authorizeUrl;
        this.set({ starting: false, connection: { since: Date.now(), authorizeUrl, hadKey } });
        this.poller = setInterval(() => void this.tick(), POLL_MS);
      } catch (error) {
        tab?.close();
        this.set({ starting: false });
        this.report(messageOf(error));
      }
    })();
  }

  /** Stops at once; the next Connect waits for the engine to have served this. */
  cancel() {
    this.stopPolling();
    this.cancelling = (async () => {
      await this.engine.call("oauth.cancel").catch(() => undefined);
      // The cancel may have removed a key a committed callback had written.
      const settings = await this.engine.call("settings.get").catch(() => undefined);
      if (settings) this.set({ settings });
    })();
  }

  /** The engine cancelled the attempt when a key was sent or removed; the next poll would read a lost connection. */
  keyChosen() {
    this.stopPolling();
  }

  private stopPolling() {
    clearInterval(this.poller);
    this.poller = undefined;
    if (this.state.connection !== undefined || this.state.starting) this.set({ connection: undefined, starting: false });
  }

  private async tick() {
    const connection = this.state.connection;
    if (connection === undefined || this.polling) return;
    // A backstop: the engine fails its own attempt on the same clock.
    if (Date.now() - connection.since > OAUTH_ATTEMPT_MS) {
      this.stopPolling();
      this.report(OAUTH_NOTHING_CAME_BACK);
      return;
    }
    this.polling = true;
    try {
      let answer;
      try {
        answer = await this.engine.call("oauth.pending");
      } catch {
        return; // not an answer: wait for the next tick
      }
      if (this.state.connection !== connection) return;
      if (answer.state === "failed") {
        this.stopPolling();
        this.report(answer.reason === "" ? CONNECT_FAILED : answer.reason);
      } else if (answer.state === "none") {
        this.stopPolling();
        this.report(CONNECTION_LOST);
      } else if (answer.state === "done") {
        await this.landed(connection);
      }
    } finally {
      this.polling = false;
    }
  }

  private async landed(connection: PendingConnection) {
    const [settings, keyStatus] = await Promise.all([
      this.engine.call("settings.get").catch(() => undefined),
      this.engine.call("oauth.status").catch(() => undefined),
    ]);
    if (this.state.connection !== connection) return;
    this.stopPolling();
    this.statusFetch++;
    showNotice(CONNECTED_MESSAGE, "info");
    const freeTier = keyStatus !== undefined && "isFreeTier" in keyStatus && keyStatus.isFreeTier;
    // A toast cannot carry the Credits link, so a free-tier account keeps the dialog.
    const open = connection.hadKey || freeTier ? this.state.open : false;
    this.set({
      ...(settings ? { settings } : {}),
      keyStatus,
      open,
      report: undefined,
      resets: connection.hadKey ? this.state.resets + 1 : this.state.resets,
    });
  }
}

export const useSettingsUi = (ui: SettingsUi): SettingsUiState => useSyncExternalStore(ui.subscribe, ui.current);
