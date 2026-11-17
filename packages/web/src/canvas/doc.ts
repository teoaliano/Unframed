import type { Kit } from "@unframed/domain";
import { createContext, useContext } from "react";
import { isPageId, TLDOCUMENT_ID, TLINSTANCE_ID, type Editor, type TLRecord, type TLShape, type TLShapeId, type TLStore } from "tldraw";

/** A shape as the app reads it: no tldraw types past this file. */
export interface DocShape {
  readonly id: string;
  readonly type: string;
  readonly props: object;
}

interface Change {
  readonly before: TLShape;
  readonly after: TLShape;
}

/**
 * The open project's synced canvas, read and written without a mounted tldraw editor, so the artifact
 * editor can live on its own page while the canvas is unmounted. Reads are reactive (signia). While the
 * canvas is mounted it attaches its editor and writes join tldraw's undo history; otherwise the doc keeps
 * its own, which a later attach discards because a freshly mounted canvas starts with an empty history.
 */
export class CanvasDoc {
  private editor: Editor | undefined;
  private past: Change[][] = [];
  private future: Change[][] = [];
  private disposed = false;

  readonly store: TLStore;

  constructor(store: TLStore) {
    this.store = store;
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
    this.past = [];
    this.future = [];
    return () => {
      if (this.editor === editor) this.editor = undefined;
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

  kit(): Kit | null {
    const meta = (this.store.get(TLDOCUMENT_ID)?.meta ?? {}) as { unframed?: { kit?: Kit } };
    return meta.unframed?.kit ?? null;
  }

  /** Merges `props` into the shape's; a key set to `undefined` is removed. One undo step per call. */
  update(id: string, props: Readonly<Record<string, unknown>>, label: string): void {
    const before = this.store.get(id as TLShapeId);
    if (before?.typeName !== "shape") return;
    const merged: Record<string, unknown> = { ...(before.props as Record<string, unknown>), ...props };
    for (const [key, value] of Object.entries(props)) if (value === undefined) delete merged[key];
    const after = { ...before, props: merged } as TLShape;
    if (this.editor) {
      this.editor.markHistoryStoppingPoint(label);
      this.store.put([after]);
      return;
    }
    this.store.put([after]);
    this.past.push([{ before, after }]);
    this.future = [];
  }

  undo(): void {
    if (this.editor) return void this.editor.undo();
    const step = this.past.pop();
    if (!step) return;
    this.restore(step.map((change) => change.before));
    this.future.push(step);
  }

  redo(): void {
    if (this.editor) return void this.editor.redo();
    const step = this.future.pop();
    if (!step) return;
    this.restore(step.map((change) => change.after));
    this.past.push(step);
  }

  private restore(records: TLShape[]): void {
    const present = records.filter((record) => this.store.has(record.id));
    if (present.length > 0) this.store.put(present);
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

export const useCanvasDoc = (): CanvasDoc => {
  const doc = useContext(CanvasDocContext);
  if (!doc) throw new Error("useCanvasDoc needs a CanvasDocContext provider.");
  return doc;
};
