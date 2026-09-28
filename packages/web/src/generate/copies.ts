import type { Editor, TLShape, TLShapeId } from "tldraw";
import { resultMetaOf, runMarkerOf, unframedMetaOf } from "@unframed/contracts";

/**
 * A copy never claims someone else's run: every shape this tab creates that carries a run
 * marker, a run error or an unfilled placeholder's result meta loses them, whether it came
 * from paste, duplicate or a paste from another project. The one exception is a shape this
 * tab deleted coming back under its own id, which is undo: it keeps its marker, and the
 * engine resolves it.
 */
export const installCopyStripping = (editor: Editor): (() => void) => {
  const deleted = new Set<TLShapeId>();
  const stopDelete = editor.sideEffects.registerAfterDeleteHandler("shape", (shape, source) => {
    if (source === "user") deleted.add(shape.id);
  });
  const stopCreate = editor.sideEffects.registerBeforeCreateHandler("shape", (shape: TLShape, source) => {
    if (source !== "user" || deleted.has(shape.id)) return shape;
    const unframed = unframedMetaOf(shape);
    const result = resultMetaOf(shape);
    const unfilled = result !== undefined && result.sidecar === null;
    if (!runMarkerOf(shape) && unframed.runError === undefined && !unfilled) return shape;
    const { run: _run, runError: _runError, result: _result, ...rest } = unframed;
    const kept = unfilled ? rest : { ...rest, ...(result ? { result } : {}) };
    const { unframed: _unframed, ...meta } = shape.meta as Record<string, unknown>;
    return { ...shape, meta: Object.keys(kept).length > 0 ? { ...meta, unframed: kept } : meta } as TLShape;
  });
  return () => {
    stopDelete();
    stopCreate();
  };
};
