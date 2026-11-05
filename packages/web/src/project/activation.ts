import { UnframedError } from "@unframed/contracts";
import {
  closeTab as closeTabRule,
  editorTabKey,
  editorTabsOf,
  isEditorTab,
  moveTab,
  openEditorTab,
  openTab,
  pinTab,
  popClosed,
  projectOfTab,
  pushClosed,
  restoreTabs,
  unpinTab,
} from "@unframed/domain";
import { useSyncExternalStore } from "react";
import { isConnectionFailure, type EngineConnection } from "../rpc/engine.ts";
import { showError } from "../toasts.tsx";

export const ACTIVE_PROJECT_KEY = "project.active";
/** The saved tabs (spec 17): the order and the active tab. It replaces `project.active` as the place a restart reads from. */
export const TABS_KEY = "project.tabs";
const LIST_RETRY_MS = 1000;
export const DEFAULT_PROJECT = "default";

const messageOf = (error: unknown): string =>
  error instanceof UnframedError || error instanceof Error ? error.message : String(error);

/** Something that must settle before the active project changes (the open canvas's pending edits). */
export type BeforeSwitch = () => Promise<void>;

/** The tab state the strip and the canvas read. A new object on every change, so a subscriber can compare by identity. */
export interface EditorTab {
  readonly title: string;
  readonly kind: string;
}

export interface TabState {
  /** The project whose canvas is mounted, or undefined when no tab is open (the start state). */
  readonly active: string | undefined;
  readonly editing: string | undefined;
  readonly editors: ReadonlyMap<string, EditorTab>;
  /** Every open tab, in the order the strip shows them. */
  readonly order: ReadonlyArray<string>;
  readonly pinned: ReadonlyArray<string>;
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
  private state: TabState = { active: undefined, editing: undefined, editors: new Map(), order: [], pinned: [], closed: [], loaded: false };
  private readonly listeners = new Set<() => void>();
  private beforeSwitch: BeforeSwitch | undefined;
  /** Counts activations, so an initial load that finishes after a switch does not override it. */
  private generation = 0;
  private readonly engine: EngineConnection;

  constructor(engine: EngineConnection) {
    this.engine = engine;
  }

  activeProject = (): string | undefined => this.state.active;

  selectedTab = (): string | undefined => this.state.editing ?? this.state.active;

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
    const { order, active, pinned, editing, editors } = this.state;
    const open = order.filter(isEditorTab).map((key) => ({ key, title: editors.get(key)?.title ?? "", kind: editors.get(key)?.kind ?? "page" }));
    const value = { order: [...order], active: active ?? null, pinned: [...pinned], editing: editing ?? null, editors: open };
    this.engine.call("preferences.set", { key: TABS_KEY, value }).catch((error: unknown) => {
      showError(`Could not save the open tabs: ${messageOf(error)}`);
    });
  }

  async activate(key: string): Promise<void> {
    this.generation++;
    const name = projectOfTab(key);
    const editing = isEditorTab(key) ? key : undefined;
    const projectOrder = openTab(this.state.order, name);
    const order = editing === undefined ? projectOrder : openEditorTab({ order: projectOrder, pinned: this.state.pinned }, editing);
    if (name === this.state.active) {
      if (order.length !== this.state.order.length || editing !== this.state.editing) this.update({ order, editing });
      this.persistTabs();
      return;
    }
    await this.beforeSwitch?.();
    this.update({ active: name, editing, order });
    this.persistTabs();
    await this.engine.call("preferences.set", { key: ACTIVE_PROJECT_KEY, value: name }).catch((error: unknown) => {
      showError(`Could not open “${name}”: ${messageOf(error)}`);
    });
  }

  async openEditor(project: string, shape: string, about: EditorTab): Promise<void> {
    const key = editorTabKey(project, shape);
    this.describeEditor(key, about);
    await this.activate(key);
  }

  describeEditor(key: string, about: EditorTab): void {
    const known = this.state.editors.get(key);
    if (known?.title === about.title && known.kind === about.kind) return;
    this.update({ editors: new Map(this.state.editors).set(key, about) });
    if (this.state.order.includes(key)) this.persistTabs();
  }

  /**
   * Closes a tab (spec 17). Closing the active one settles its canvas first, then activates
   * the neighbour; a background tab only leaves the strip. Closing deletes nothing.
   */
  async closeTab(name: string): Promise<void> {
    if (!this.state.order.includes(name)) return;
    const selected = this.selectedTab();
    const next = closeTabRule(this.state.order, selected, name);
    const nextProject = next.active === undefined ? undefined : projectOfTab(next.active);
    const switching = nextProject !== this.state.active;
    if (switching) {
      this.generation++;
      await this.beforeSwitch?.();
    }
    const gone = isEditorTab(name) ? [name] : [...editorTabsOf(this.state.order, name).toReversed(), name];
    const closed = gone.reduce((stack, each) => pushClosed(stack, each), this.state.closed);
    const editing = next.active !== undefined && isEditorTab(next.active) ? next.active : undefined;
    this.update({ order: next.order, active: nextProject, editing, pinned: this.state.pinned.filter((each) => each !== name), closed });
    this.persistTabs();
    if (switching) {
      await this.engine.call("preferences.set", { key: ACTIVE_PROJECT_KEY, value: nextProject ?? null }).catch(() => undefined);
    }
  }

  /** Closes every tab (the right-click menu's Close all tabs). The projects stay; the canvas settles first. */
  async closeAllTabs(): Promise<void> {
    if (this.state.order.length === 0) return;
    this.generation++;
    await this.beforeSwitch?.();
    const closed = [...this.state.order].reverse().reduce((stack, name) => pushClosed(stack, name), this.state.closed);
    this.update({ order: [], active: undefined, editing: undefined, pinned: [], closed });
    this.persistTabs();
    await this.engine.call("preferences.set", { key: ACTIVE_PROJECT_KEY, value: null }).catch(() => undefined);
  }

  /** Moves a tab to position `to` in the strip. Saved so the order survives a restart. */
  moveTab(name: string, to: number): void {
    this.update(moveTab(this.state, name, to));
    this.persistTabs();
  }

  pinTab(name: string): void {
    this.update(pinTab(this.state, name));
    this.persistTabs();
  }

  unpinTab(name: string): void {
    this.update(unpinTab(this.state, name));
    this.persistTabs();
  }

  /** Cmd+Shift+T: opens the most recently closed project in a new tab at the end. */
  async reopenClosed(): Promise<void> {
    const { name, stack } = popClosed(this.state.closed);
    if (name === undefined) return;
    this.update({ closed: stack });
    if (isEditorTab(name) && !this.state.order.includes(projectOfTab(name))) {
      await this.activate(projectOfTab(name));
    }
    await this.activate(name);
  }

  /** A rename keeps the tab's place: the old name becomes the new one everywhere the tabs are kept. */
  renameTab(from: string, to: string): void {
    // The active one is switched by `activate(to)`, which settles the canvas first; only the places change here.
    const rename = (name: string) => (name === from ? to : isEditorTab(name) && projectOfTab(name) === from ? `${to}${name.slice(from.length)}` : name);
    const swap = (names: ReadonlyArray<string>) => names.map(rename);
    const editors = new Map([...this.state.editors].map(([key, about]) => [rename(key), about] as const));
    const editing = this.state.editing === undefined ? undefined : rename(this.state.editing);
    this.update({ order: swap(this.state.order), pinned: swap(this.state.pinned), closed: swap(this.state.closed), editors, editing });
    this.persistTabs();
  }

  /** A deleted background project leaves the strip without touching the canvas. */
  forgetTab(name: string): void {
    const other = (each: string) => projectOfTab(each) !== name;
    this.update({ order: this.state.order.filter(other), pinned: this.state.pinned.filter(other), closed: this.state.closed.filter(other) });
    this.persistTabs();
  }

  /** Lets the open canvas's pending edits reach the engine, before a change that closes its room. */
  settle(): Promise<void> {
    return this.beforeSwitch?.() ?? Promise.resolve();
  }

  /**
   * After an output folder change (spec 10): the canvas unmounts first, because the same name
   * is another project in the new folder. The saved tabs are read again against the new folder.
   */
  async reopen(): Promise<void> {
    this.update({ active: undefined, editing: undefined, editors: new Map(), order: [], pinned: [], closed: [], loaded: false });
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
    const saved = prefs[TABS_KEY] as { order?: unknown; active?: unknown; pinned?: unknown; editing?: unknown; editors?: unknown } | undefined;
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
    const savedPins = Array.isArray(saved?.pinned) ? saved.pinned.filter((name): name is string => typeof name === "string") : [];
    const savedActive = typeof saved?.editing === "string" ? saved.editing : typeof saved?.active === "string" ? saved.active : null;
    const restored = restoreTabs({ order: savedOrder, active: savedActive, pinned: savedPins }, projects);
    if (restored.active !== undefined) {
      this.update({ order: restored.order, pinned: restored.pinned, editors: savedEditors(saved?.editors), closed: [], loaded: true });
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

const savedEditors = (value: unknown): ReadonlyMap<string, EditorTab> => {
  const editors = new Map<string, EditorTab>();
  if (!Array.isArray(value)) return editors;
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const { key, title, kind } = entry as { key?: unknown; title?: unknown; kind?: unknown };
    if (typeof key === "string" && isEditorTab(key)) editors.set(key, { title: typeof title === "string" ? title : "", kind: typeof kind === "string" ? kind : "page" });
  }
  return editors;
};

export const useActiveProject = (activation: ProjectActivation): string | undefined =>
  useSyncExternalStore(activation.subscribe, activation.activeProject);

/** The whole tab state, for the strip (spec 17). */
export const useTabState = (activation: ProjectActivation): TabState => useSyncExternalStore(activation.subscribe, activation.tabState);
