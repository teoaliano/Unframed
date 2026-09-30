import { UnframedError } from "@unframed/contracts";
import { useSyncExternalStore } from "react";
import { isConnectionFailure, type EngineConnection } from "../rpc/engine.ts";
import { showError } from "../toasts.tsx";

export const ACTIVE_PROJECT_KEY = "project.active";
const LIST_RETRY_MS = 1000;
export const DEFAULT_PROJECT = "default";

const messageOf = (error: unknown): string =>
  error instanceof UnframedError || error instanceof Error ? error.message : String(error);

/** Something that must settle before the active project changes (the open canvas's pending edits). */
export type BeforeSwitch = () => Promise<void>;

/**
 * The active project. It lives in two places only, this state and the `project.active`
 * preference, and `activate` is the only function that writes either.
 */
export class ProjectActivation {
  private active: string | undefined;
  private readonly listeners = new Set<() => void>();
  private beforeSwitch: BeforeSwitch | undefined;
  /** Counts activations, so an initial load that finishes after a switch does not override it. */
  private generation = 0;
  private readonly engine: EngineConnection;

  constructor(engine: EngineConnection) {
    this.engine = engine;
  }

  activeProject = (): string | undefined => this.active;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** The open canvas registers what must settle before it is closed. */
  setBeforeSwitch(hook: BeforeSwitch | undefined): void {
    this.beforeSwitch = hook;
  }

  async activate(name: string): Promise<void> {
    this.generation++;
    if (name === this.active) return;
    await this.beforeSwitch?.();
    this.active = name;
    for (const listener of this.listeners) listener();
    await this.engine.call("preferences.set", { key: ACTIVE_PROJECT_KEY, value: name }).catch((error: unknown) => {
      showError(`Could not open “${name}”: ${messageOf(error)}`);
    });
  }

  /** Lets the open canvas's pending edits reach the engine, before a change that closes its room. */
  settle(): Promise<void> {
    return this.beforeSwitch?.() ?? Promise.resolve();
  }

  /**
   * After an output folder change (spec 10): the remembered project if the new folder has
   * it, else the first, else a new `default`. The canvas unmounts first, because the same
   * name is another project in the new folder.
   */
  async reopen(): Promise<void> {
    this.active = undefined;
    for (const listener of this.listeners) listener();
    await this.initialLoad();
  }

  /**
   * Waits for the engine, reads the remembered project and the project list, and opens
   * one: the remembered one, else the first, else a new `default`. A list that fails is
   * tried once more after a second; a second failure opens nothing.
   */
  async initialLoad(): Promise<void> {
    const started = this.generation;
    const remembered = await this.engine
      .call("preferences.get", { keys: [ACTIVE_PROJECT_KEY] })
      .then((answer) => answer.values[ACTIVE_PROJECT_KEY])
      .catch(() => undefined);
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
    await this.activate(target);
  }
}

export const useActiveProject = (activation: ProjectActivation): string | undefined =>
  useSyncExternalStore(activation.subscribe, activation.activeProject);
