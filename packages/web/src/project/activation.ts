import { UnframedError } from "@unframed/contracts";
import { closeTab as closeTabRule, moveTab, openTab, popClosed, pushClosed, restoreTabs } from "@unframed/domain";
import { useSyncExternalStore } from "react";
import { isConnectionFailure, type EngineConnection } from "../rpc/engine.ts";
import { showError } from "../toasts.tsx";

export const ACTIVE_PROJECT_KEY = "project.active";
/** The saved tabs: the order and the active tab. It replaces `project.active` as the place a restart reads from. */
export const TABS_KEY = "project.tabs";
const LIST_RETRY_MS = 1000;
export const DEFAULT_PROJECT = "default";

const messageOf = (error: unknown): string =>
  error instanceof UnframedError || error instanceof Error ? error.message : String(error);

/** Something that must settle before the active project changes (the open canvas's pending edits). */
export type BeforeSwitch = () => Promise<void>;

/** The tab state the strip and the canvas read. A new object on every change, so a subscriber can compare by identity. */
export interface TabState {
  /** The project whose canvas is mounted, or undefined when no tab is open (the start state). */
  readonly active: string | undefined;
  /** Every open tab, in the order the strip shows them. */
  readonly order: ReadonlyArray<string>;
  /** Projects closed from the strip, newest first, for Cmd+Shift+T. In memory only. */
  readonly closed: ReadonlyArray<string>;
  /** False until the first load has settled, so the start state is not shown while the app is still opening. */
  readonly loaded: boolean;
}

/**
 * The active project and the open tabs. They live in this state, and the preferences store
 * keeps copies (`project.active` for the engine's outside-agent view, `project.tabs` for a
 * restart). `activate` is the only function that changes the active project.
 */
export class ProjectActivation {
  private state: TabState = { active: undefined, order: [], closed: [], loaded: false };
  private readonly listeners = new Set<() => void>();
  private beforeSwitch: BeforeSwitch | undefined;
  /** Counts activations, so an initial load that finishes after a switch does not override it. */
  private generation = 0;
  private readonly engine: EngineConnection;

  constructor(engine: EngineConnection) {
    this.engine = engine;
  }

  activeProject = (): string | undefined => this.state.active;

  tabState = (): TabState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** The open canvas registers what must settle before it is closed. */
  setBeforeSwitch(hook: BeforeSwitch | undefined): void {
    this.beforeSwitch = hook;
  }

  private update(next: Partial<Omit<TabState, "loaded">> & { loaded?: boolean }): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  private persistTabs(): void {
    const { order, active } = this.state;
    this.engine.call("preferences.set", { key: TABS_KEY, value: { order: [...order], active: active ?? null } }).catch((error: unknown) => {
      showError(`Could not save the open tabs: ${messageOf(error)}`);
    });
  }

  async activate(name: string): Promise<void> {
    this.generation++;
    const order = openTab(this.state.order, name);
    if (name === this.state.active) {
      if (order.length !== this.state.order.length) this.update({ order });
      this.persistTabs();
      return;
    }
    await this.beforeSwitch?.();
    // Opening a project already open keeps its tab; a new one joins the end.
    this.update({ active: name, order });
    this.persistTabs();
    await this.engine.call("preferences.set", { key: ACTIVE_PROJECT_KEY, value: name }).catch((error: unknown) => {
      showError(`Could not open “${name}”: ${messageOf(error)}`);
    });
  }

  /**
   * Closes a tab. Closing the active one settles its canvas first, then activates
   * the neighbour; a background tab only leaves the strip. Closing deletes nothing.
   */
  async closeTab(name: string): Promise<void> {
    if (!this.state.order.includes(name)) return;
    const wasActive = name === this.state.active;
    if (wasActive) {
      this.generation++;
      await this.beforeSwitch?.();
    }
    const next = closeTabRule(this.state.order, this.state.active, name);
    const closed = pushClosed(this.state.closed, name);
    this.update({ order: next.order, active: next.active, closed });
    this.persistTabs();
    if (wasActive) {
      await this.engine.call("preferences.set", { key: ACTIVE_PROJECT_KEY, value: next.active ?? null }).catch(() => undefined);
    }
  }

  /** Closes every tab (the right-click menu's Close all tabs). The projects stay; the canvas settles first. */
  async closeAllTabs(): Promise<void> {
    if (this.state.order.length === 0) return;
    this.generation++;
    await this.beforeSwitch?.();
    const closed = [...this.state.order].reverse().reduce((stack, name) => pushClosed(stack, name), this.state.closed);
    this.update({ order: [], active: undefined, closed });
    this.persistTabs();
    await this.engine.call("preferences.set", { key: ACTIVE_PROJECT_KEY, value: null }).catch(() => undefined);
  }

  /** Moves a tab to position `to` in the strip. Saved so the order survives a restart. */
  moveTab(name: string, to: number): void {
    this.update({ order: moveTab(this.state.order, name, to) });
    this.persistTabs();
  }

  /** Cmd+Shift+T: opens the most recently closed project in a new tab at the end. */
  async reopenClosed(): Promise<void> {
    const { name, stack } = popClosed(this.state.closed);
    if (name === undefined) return;
    this.update({ closed: stack });
    await this.activate(name);
  }

  /** A rename keeps the tab's place: the old name becomes the new one everywhere the tabs are kept. */
  renameTab(from: string, to: string): void {
    // The active one is switched by `activate(to)`, which settles the canvas first; only the places change here.
    const swap = (names: ReadonlyArray<string>) => names.map((name) => (name === from ? to : name));
    this.update({ order: swap(this.state.order), closed: swap(this.state.closed) });
    this.persistTabs();
  }

  /** A deleted background project leaves the strip without touching the canvas. */
  forgetTab(name: string): void {
    this.update({ order: this.state.order.filter((each) => each !== name), closed: this.state.closed.filter((each) => each !== name) });
    this.persistTabs();
  }

  /** Lets the open canvas's pending edits reach the engine, before a change that closes its room. */
  settle(): Promise<void> {
    return this.beforeSwitch?.() ?? Promise.resolve();
  }

  /**
   * After an output folder change: the canvas unmounts first, because the same name
   * is another project in the new folder. The saved tabs are read again against the new folder.
   */
  async reopen(): Promise<void> {
    this.update({ active: undefined, order: [], closed: [], loaded: false });
    await this.initialLoad();
  }

  /**
   * Waits for the engine, reads the saved tabs and the project list, and opens them: the saved
   * tabs that still exist, in their order, with the saved active one. With no saved tab, the
   * remembered project (`project.active`, from before tabs), else the first, else a new `default`.
   * A list that fails is tried once more after a second; a second failure opens nothing.
   */
  async initialLoad(): Promise<void> {
    const started = this.generation;
    const prefs = await this.engine
      .call("preferences.get", { keys: [TABS_KEY, ACTIVE_PROJECT_KEY] })
      .then((answer) => answer.values)
      .catch(() => ({}) as Record<string, unknown>);
    const remembered = prefs[ACTIVE_PROJECT_KEY];
    const saved = prefs[TABS_KEY] as { order?: unknown; active?: unknown } | undefined;
    let projects: ReadonlyArray<string> | undefined;
    let failure: unknown;
    for (let attempt = 0; projects === undefined; ) {
      try {
        projects = (await this.engine.call("projects.list")).projects;
      } catch (error) {
        // A drop is not a failed list: the call waits for the socket and runs again.
        if (isConnectionFailure(error)) continue;
        failure = error;
        if (++attempt >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, LIST_RETRY_MS));
      }
    }
    if (projects === undefined) {
      showError(`Could not list your projects: ${messageOf(failure)}. Reload to try again.`, { id: "project-list", sticky: true });
      return;
    }
    if (this.generation !== started) return;

    const savedOrder = Array.isArray(saved?.order) ? saved.order.filter((name): name is string => typeof name === "string") : [];
    const restored = restoreTabs({ order: savedOrder, active: typeof saved?.active === "string" ? saved.active : null }, projects);
    if (restored.active !== undefined) {
      this.update({ order: restored.order, closed: [], loaded: true });
      await this.activate(restored.active);
      return;
    }

    let target: string;
    if (typeof remembered === "string" && projects.includes(remembered)) target = remembered;
    else if (projects[0] !== undefined) target = projects[0];
    else {
      try {
        target = (await this.engine.call("projects.create", { name: DEFAULT_PROJECT })).name;
      } catch (error) {
        showError(`Could not open “${DEFAULT_PROJECT}”: ${messageOf(error)}`);
        return;
      }
    }
    if (this.generation !== started) return;
    this.update({ loaded: true });
    await this.activate(target);
  }
}

export const useActiveProject = (activation: ProjectActivation): string | undefined =>
  useSyncExternalStore(activation.subscribe, activation.activeProject);

/** The whole tab state, for the strip. */
export const useTabState = (activation: ProjectActivation): TabState => useSyncExternalStore(activation.subscribe, activation.tabState);
