import { randomUUID } from "node:crypto";
import type { SelectionApply } from "@unframed/contracts";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

/** The note an outside call gets when no window has the project open (spec 14, "The live selection"). */
export const NO_WINDOW_NOTE = "Unframed has no window open on this project, so there is no selection to read.";

/** How long a `canvas_select` waits for the window to report the selection it was asked for. */
export const APPLY_WAIT_MS = 2000;

interface WindowState {
  /** The most recent report's order: the window that changed most recently has the highest. */
  seq: number;
  shapeIds: string[] | undefined;
  /** Delivers an apply request to the window's selection stream. Absent for a window that only reports. */
  listen: ((item: SelectionApply) => void) | undefined;
  waiters: Array<() => void>;
}

/**
 * The selection of each Unframed window on each project's canvas, as the windows report it. Engine
 * state only: nothing here is saved, and a window's selection is dropped when its stream closes.
 */
export class LiveSelection {
  private readonly projects = new Map<string, Map<string, WindowState>>();
  private counter = 0;

  /** A window opens its selection stream. The returned function drops the window. */
  attach(project: string, windowId: string, listen: (item: SelectionApply) => void): () => void {
    const windows = this.windowsOf(project);
    const existing = windows.get(windowId);
    if (existing) existing.listen = listen;
    else windows.set(windowId, { seq: 0, shapeIds: undefined, listen, waiters: [] });
    return () => {
      const current = this.projects.get(project);
      current?.delete(windowId);
      if (current?.size === 0) this.projects.delete(project);
    };
  }

  /** A window reports its selection on the project it shows. */
  report(project: string, windowId: string, shapeIds: ReadonlyArray<string>): void {
    const windows = this.windowsOf(project);
    const state = windows.get(windowId) ?? { seq: 0, shapeIds: undefined, listen: undefined, waiters: [] };
    windows.set(windowId, state);
    state.seq = ++this.counter;
    state.shapeIds = [...new Set(shapeIds)];
    const waiting = state.waiters.splice(0);
    for (const wake of waiting) wake();
  }

  /** The selection an outside read answers: the most recently changed window's, or the note when none is open. */
  current(project: string): { shapeIds: string[]; note?: string } {
    const windows = this.projects.get(project);
    if (windows === undefined || windows.size === 0) return { shapeIds: [], note: NO_WINDOW_NOTE };
    let chosen: WindowState | undefined;
    for (const state of windows.values()) if (state.shapeIds !== undefined && (chosen === undefined || state.seq > chosen.seq)) chosen = state;
    return { shapeIds: chosen?.shapeIds ? [...chosen.shapeIds] : [] };
  }

  /**
   * Asks the most recently changed window to select these shapes, and answers the selection that
   * window reports back. Waits at most APPLY_WAIT_MS, then answers the last report it had.
   */
  async apply(project: string, shapeIds: ReadonlyArray<string>): Promise<{ shapeIds: string[]; note?: string }> {
    const windows = this.projects.get(project);
    let target: WindowState | undefined;
    for (const state of windows?.values() ?? []) {
      if (state.listen !== undefined && (target === undefined || state.seq > target.seq)) target = state;
    }
    if (target === undefined) return { shapeIds: [], note: NO_WINDOW_NOTE };
    const reported = new Promise<void>((resolve) => target!.waiters.push(resolve));
    target.listen!({ kind: "apply", requestId: randomUUID(), shapeIds: [...shapeIds] });
    await Promise.race([reported, new Promise<void>((resolve) => setTimeout(resolve, APPLY_WAIT_MS).unref())]);
    return { shapeIds: target.shapeIds ? [...target.shapeIds] : [] };
  }

  private windowsOf(project: string): Map<string, WindowState> {
    let windows = this.projects.get(project);
    if (windows === undefined) {
      windows = new Map();
      this.projects.set(project, windows);
    }
    return windows;
  }
}

/** The one live selection of this engine, shared by the RPC methods and the outside tools. */
export class SelectionHub extends Context.Service<SelectionHub, LiveSelection>()("unframed/engine/SelectionHub") {}

export const selectionHubLayer = Layer.sync(SelectionHub, () => new LiveSelection());
