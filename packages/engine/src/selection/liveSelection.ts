import { randomUUID } from "node:crypto";
import type { SelectionApply, SelectionSnapshotResult } from "@unframed/contracts";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

/** The note an outside call gets when no window has the project open (spec 14, "The live selection"). */
export const NO_WINDOW_NOTE = "Unframed has no window open on this project, so there is no selection to read.";

/** How long a `canvas_select` waits for the window to report the selection it was asked for. */
export const APPLY_WAIT_MS = 2000;

/** How long a `canvas_snapshot` waits for the window to draw the area. */
export const SNAPSHOT_WAIT_MS = 15000;

export const SNAPSHOT_NO_WINDOW = "Unframed has no window open on this project, so there is nothing to look at. Ask the person to open the project in Unframed.";
export const SNAPSHOT_TIMED_OUT = "The Unframed window did not draw the snapshot in time. Try a smaller area.";

export type SnapshotAnswer = { readonly png: string; readonly width: number; readonly height: number } | { readonly error: string };

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
  private readonly snapshots = new Map<string, (answer: SnapshotAnswer) => void>();
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

  /** Asks the most recently changed window to draw an area of the canvas, as the person sees it. */
  async snapshot(project: string, bounds: { x: number; y: number; w: number; h: number }, scale: number, waitMs = SNAPSHOT_WAIT_MS): Promise<SnapshotAnswer> {
    const target = this.listenerOf(project);
    if (target === undefined) return { error: SNAPSHOT_NO_WINDOW };
    const requestId = randomUUID();
    let timer: NodeJS.Timeout | undefined;
    const answered = new Promise<SnapshotAnswer>((resolve) => {
      this.snapshots.set(requestId, resolve);
      timer = setTimeout(() => resolve({ error: SNAPSHOT_TIMED_OUT }), waitMs);
      timer.unref();
    });
    target.listen!({ kind: "snapshot", requestId, bounds, scale });
    const answer = await answered;
    clearTimeout(timer);
    this.snapshots.delete(requestId);
    return answer;
  }

  /** A window answers a snapshot request. An answer nobody waits for any more is dropped. */
  snapshotResult(result: SelectionSnapshotResult): void {
    const resolve = this.snapshots.get(result.requestId);
    if (resolve === undefined) return;
    if (result.png !== undefined && result.width !== undefined && result.height !== undefined) resolve({ png: result.png, width: result.width, height: result.height });
    else resolve({ error: result.error ?? "The Unframed window could not draw the snapshot." });
  }

  private listenerOf(project: string): WindowState | undefined {
    let target: WindowState | undefined;
    for (const state of this.projects.get(project)?.values() ?? []) {
      if (state.listen !== undefined && (target === undefined || state.seq > target.seq)) target = state;
    }
    return target;
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
