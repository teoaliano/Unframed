import type { Kit } from "@unframed/domain";
import { createContext, useContext } from "react";
import { isPageId, TLDOCUMENT_ID, TLINSTANCE_ID, useMaybeEditor, type Editor, type TLAsset, type TLAssetId, type TLParentId, type TLRecord, type TLShape, type TLShapeId, type TLStore } from "tldraw";

/** A shape as the app reads it: no tldraw types past this file. */
export interface DocShape {
  readonly id: string;
  readonly type: string;
  readonly props: object;
}

/**
 * The editor reads the agent's composer and transcript make, which a mounted canvas answers itself and the
 * doc answers on an editor tab.
 */
export type CanvasReader = Pick<Editor, "getShape" | "getAsset" | "getSelectedShapeIds" | "getSelectedShapes" | "getSortedChildIdsForParent" | "getCurrentPageShapesSorted">;

interface Change {
  readonly before: TLShape;
  readonly after: TLShape;
}

const docs = new WeakMap<TLStore, CanvasDoc>();

/** The doc over a store, for canvas code that only has the editor. */
export const canvasDocOf = (store: TLStore): CanvasDoc | undefined => docs.get(store);

/** The doc's own undo steps; older ones drop off. */
const KEPT_STEPS = 100;

/**
 * The open project's synced canvas, read and written without a mounted tldraw editor, so the artifact
 * editor can live on its own page while the canvas is unmounted. Reads are reactive (signia).
 *
 * Undo: while the canvas is mounted it attaches its editor and writes join tldraw's history. Without one
 * the doc keeps its own steps. They outlive the next mount, which starts with an empty tldraw history, and
 * the canvas reaches them through `undo`/`redo` once tldraw has nothing left to undo or redo, so an edit made
 * on the editor tab is still one Cmd-Z away back on the canvas. Steps made after the canvas did something
 * undoable would undo out of order, so a detach that leaves tldraw history behind drops them.
 */
export class CanvasDoc {
  private editor: Editor | undefined;
  private past: Change[][] = [];
  private future: Change[][] = [];
  private restoring = false;
  private disposed = false;

  readonly store: TLStore;

  constructor(store: TLStore) {
    this.store = store;
    docs.set(store, this);
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    this.disposed = true;
    this.editor = undefined;
  }

  attach(editor: Editor): () => void {
    this.editor = editor;
    const stopListening = this.store.listen(
      () => {
        if (!this.restoring) this.future = [];
      },
      { source: "user", scope: "document" },
    );
    return () => {
      stopListening();
      if (this.editor !== editor) return;
      this.editor = undefined;
      if (editor.getCanUndo() || editor.getCanRedo()) {
        this.past = [];
        this.future = [];
      }
    };
  }

  shape(id: string): DocShape | undefined {
    const record = this.store.get(id as TLShapeId);
    return record?.typeName === "shape" ? record : undefined;
  }

  /** The shapes on the current page, nested ones included, like `editor.getCurrentPageShapes()`. */
  pageShapes(): DocShape[] {
    const page = this.currentPage();
    if (page === undefined) return [];
    return this.store.query.records("shape").get().filter((shape) => this.pageOf(shape) === page);
  }

  /** Selects `ids` on the current page, as `editor.select` would, without an editor. */
  select(ids: ReadonlyArray<string>): void {
    const state = this.pageState();
    if (state === undefined || this.editor) return;
    const same = state.selectedShapeIds.length === ids.length && state.selectedShapeIds.every((id, index) => id === ids[index]);
    if (!same) this.store.put([{ ...state, selectedShapeIds: [...ids] as TLShapeId[] }]);
  }

  readonly reader: CanvasReader = {
    getShape: ((id: TLShapeId | TLShape) => this.store.get((typeof id === "string" ? id : id.id) as TLShapeId)) as CanvasReader["getShape"],
    getAsset: ((id: TLAssetId | TLAsset) => this.store.get((typeof id === "string" ? id : id.id) as TLAssetId)) as CanvasReader["getAsset"],
    getSelectedShapeIds: () => this.pageState()?.selectedShapeIds ?? [],
    getSelectedShapes: () => (this.pageState()?.selectedShapeIds ?? []).flatMap((id) => this.store.get(id) ?? []),
    getSortedChildIdsForParent: ((parent: TLParentId | TLShape) => this.childrenOf(typeof parent === "string" ? parent : parent.id).map((shape) => shape.id)) as CanvasReader["getSortedChildIdsForParent"],
    getCurrentPageShapesSorted: () => {
      const page = this.currentPage();
      const sorted: TLShape[] = [];
      const walk = (parent: string) => {
        for (const child of this.childrenOf(parent)) {
          sorted.push(child);
          walk(child.id);
        }
      };
      if (page !== undefined) walk(page);
      return sorted;
    },
  };

  kit(): Kit | null {
    const meta = (this.store.get(TLDOCUMENT_ID)?.meta ?? {}) as { unframed?: { kit?: Kit } };
    return meta.unframed?.kit ?? null;
  }

  /**
   * Merges `props` into the shape's; a key set to `undefined` is removed. A `label` starts a new undo step;
   * without one the change joins the step before, as tldraw's unmarked changes do.
   */
  update(id: string, props: Readonly<Record<string, unknown>>, label?: string): void {
    const before = this.store.get(id as TLShapeId);
    if (before?.typeName !== "shape") return;
    const merged: Record<string, unknown> = { ...(before.props as Record<string, unknown>), ...props };
    for (const [key, value] of Object.entries(props)) if (value === undefined) delete merged[key];
    const after = { ...before, props: merged } as TLShape;
    if (this.editor) {
      if (label !== undefined) this.editor.markHistoryStoppingPoint(label);
      this.store.put([after]);
      return;
    }
    this.store.put([after]);
    const last = this.past.at(-1);
    if (label === undefined && last) last.push({ before, after });
    else this.past.push([{ before, after }]);
    if (this.past.length > KEPT_STEPS) this.past.shift();
    this.future = [];
  }

  undo(): void {
    if (this.editor?.getCanUndo()) return void this.editor.undo();
    this.undoOwn();
  }

  redo(): void {
    if (this.editor?.getCanRedo()) return void this.editor.redo();
    this.redoOwn();
  }

  /** Takes back the doc's own latest step; false when it has none. */
  undoOwn(): boolean {
    const step = this.past.pop();
    if (!step) return false;
    this.restore(step.map((change) => change.before).reverse());
    this.future.push(step);
    return true;
  }

  redoOwn(): boolean {
    const step = this.future.pop();
    if (!step) return false;
    this.restore(step.map((change) => change.after));
    this.past.push(step);
    return true;
  }

  private restore(records: TLShape[]): void {
    const present = records.filter((record) => this.store.has(record.id));
    if (present.length === 0) return;
    const editor = this.editor;
    this.restoring = true;
    try {
      if (editor) editor.run(() => this.store.put(present), { history: "ignore" });
      else this.store.put(present);
    } finally {
      this.restoring = false;
    }
  }

  private childrenOf(parent: string): TLShape[] {
    return this.store.query
      .records("shape")
      .get()
      .filter((shape) => shape.parentId === parent)
      .sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
  }

  private pageState() {
    const page = this.currentPage();
    return this.store.query.records("instance_page_state").get().find((state) => state.pageId === page);
  }

  private currentPage(): string | undefined {
    const instance = this.store.get(TLINSTANCE_ID);
    if (instance && this.store.has(instance.currentPageId)) return instance.currentPageId;
    return this.store.query.records("page").get().sort((a, b) => (a.index < b.index ? -1 : 1))[0]?.id;
  }

  private pageOf(shape: TLRecord): string | undefined {
    let parent = (shape as TLShape).parentId as string;
    for (let depth = 0; depth < 64; depth++) {
      if (isPageId(parent)) return parent;
      const next = this.store.get(parent as TLShapeId);
      if (next?.typeName !== "shape") return undefined;
      parent = next.parentId;
    }
    return undefined;
  }
}

export const CanvasDocContext = createContext<CanvasDoc | undefined>(undefined);

export const useMaybeCanvasDoc = (): CanvasDoc | undefined => useContext(CanvasDocContext);

/** The mounted canvas when there is one, else the doc's reader: what the agent's composer and transcript read. */
export const useCanvasReader = (): CanvasReader | null => {
  const editor = useMaybeEditor();
  const doc = useContext(CanvasDocContext);
  return editor ?? doc?.reader ?? null;
};

export const useCanvasDoc = (): CanvasDoc => {
  const doc = useContext(CanvasDocContext);
  if (!doc) throw new Error("useCanvasDoc needs a CanvasDocContext provider.");
  return doc;
};
