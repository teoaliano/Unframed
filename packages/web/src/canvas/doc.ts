import { createContext, useContext } from "react";
import { computed, TLDOCUMENT_ID, TLINSTANCE_ID, type Computed, type Editor, type TLRecord, type TLShape, type TLShapeId, type TLStore } from "tldraw";
import { DocHistory } from "./docHistory.ts";

export interface DocShape {
  readonly id: string;
  readonly type: string;
  readonly props: object;
}

export type StoreOwner = { readonly store: TLStore };

const byIndex = (a: TLShape, b: TLShape) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0);

const docs = new WeakMap<TLStore, CanvasDoc>();

export const canvasDocOf = (store: TLStore): CanvasDoc | undefined => docs.get(store);

export class CanvasDoc {
  private editor: Editor | undefined;
  private readonly history = new DocHistory();
  private restoring = false;
  private disposed = false;

  readonly store: TLStore;
  private readonly children: Computed<ReadonlyMap<string, ReadonlyArray<TLShape>>>;

  constructor(store: TLStore) {
    this.store = store;
    this.children = computed("canvas doc children", () => {
      const index = new Map<string, TLShape[]>();
      for (const shape of store.query.records("shape").get()) {
        const siblings = index.get(shape.parentId);
        if (siblings) siblings.push(shape);
        else index.set(shape.parentId, [shape]);
      }
      for (const siblings of index.values()) siblings.sort(byIndex);
      return index;
    });
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
        if (!this.restoring) this.history.dropRedo();
      },
      { source: "user", scope: "document" },
    );
    return () => {
      stopListening();
      if (this.editor !== editor) return;
      this.editor = undefined;
      if (editor.getCanUndo() || editor.getCanRedo()) this.history.clear();
    };
  }

  shape(id: string): DocShape | undefined {
    const record = this.store.get(id as TLShapeId);
    return record?.typeName === "shape" ? record : undefined;
  }

  childrenOf(parent: string): ReadonlyArray<TLShape> {
    return this.children.get().get(parent) ?? [];
  }

  pageShapes(): TLShape[] {
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
  }

  selectedShapeIds(): TLShapeId[] {
    return this.pageState()?.selectedShapeIds ?? [];
  }

  select(ids: ReadonlyArray<string>): void {
    const state = this.pageState();
    if (state === undefined || this.editor) return;
    const same = state.selectedShapeIds.length === ids.length && state.selectedShapeIds.every((id, index) => id === ids[index]);
    if (!same) this.store.put([{ ...state, selectedShapeIds: [...ids] as TLShapeId[] }]);
  }

  update(id: string, props: Readonly<Record<string, unknown>>, label?: string): void {
    const before = this.store.get(id as TLShapeId);
    if (before?.typeName !== "shape") return;
    const merged: Record<string, unknown> = { ...(before.props as Record<string, unknown>), ...props };
    for (const [key, value] of Object.entries(props)) if (value === undefined) delete merged[key];
    this.write(before, { ...before, props: merged } as TLShape, label);
  }

  setDocumentMeta(meta: Readonly<Record<string, unknown>>, label: string): void {
    const before = this.store.get(TLDOCUMENT_ID);
    if (!before) return;
    this.write(before, { ...before, meta: { ...meta } } as TLRecord, label, true);
  }

  private write(before: TLRecord, after: TLRecord, label: string | undefined, sealed = false): void {
    const editor = this.editor;
    if (editor) {
      if (label !== undefined) editor.markHistoryStoppingPoint(label);
      editor.run(() => this.store.put([after]), { history: "record" });
      if (sealed && label !== undefined) editor.markHistoryStoppingPoint(label);
      return;
    }
    this.store.put([after]);
    this.history.record(before, after, label, sealed);
  }

  undo(): void {
    if (this.editor?.getCanUndo()) return void this.editor.undo();
    this.undoOwn();
  }

  redo(): void {
    if (this.editor?.getCanRedo()) return void this.editor.redo();
    this.redoOwn();
  }

  undoOwn(): boolean {
    return this.restore(this.history.takeUndo());
  }

  redoOwn(): boolean {
    return this.restore(this.history.takeRedo());
  }

  private restore(records: TLRecord[] | undefined): boolean {
    if (records === undefined) return false;
    const present = records.filter((record) => this.store.has(record.id));
    if (present.length === 0) return true;
    const editor = this.editor;
    this.restoring = true;
    try {
      if (editor) editor.run(() => this.store.put(present), { history: "ignore" });
      else this.store.put(present);
    } finally {
      this.restoring = false;
    }
    return true;
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
}

export const CanvasDocContext = createContext<CanvasDoc | undefined>(undefined);

export const useMaybeCanvasDoc = (): CanvasDoc | undefined => useContext(CanvasDocContext);

export const useCanvasDoc = (): CanvasDoc => {
  const doc = useContext(CanvasDocContext);
  if (!doc) throw new Error("useCanvasDoc needs a CanvasDocContext provider.");
  return doc;
};
