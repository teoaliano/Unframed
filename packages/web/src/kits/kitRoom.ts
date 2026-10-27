/**
 * The project kit in the canvas room (spec 19): read from the document record, and written
 * as one history step per commit. Every change goes through the domain's `applyKitOps`.
 */
import { applyKitOps, type Kit, type KitOp } from "@unframed/domain";
import { TLDOCUMENT_ID, type Editor } from "tldraw";

/** The project's kit, or null when it has none. */
export const kitOf = (editor: Editor): Kit | null => {
  const document = editor.store.get(TLDOCUMENT_ID) as { meta?: { unframed?: { kit?: Kit } } } | undefined;
  return document?.meta?.unframed?.kit ?? null;
};

export type KitCommit = { readonly ok: true } | { readonly ok: false; readonly refusal: string };

/** Applies the ops to the room's kit and writes the result as one undo step. A refusal writes nothing. */
export const commitKit = (editor: Editor, ops: ReadonlyArray<KitOp>): KitCommit => {
  const result = applyKitOps(kitOf(editor), ops);
  if (!result.ok) return { ok: false, refusal: result.refusal };
  const document = editor.store.get(TLDOCUMENT_ID)!;
  const meta = (document.meta ?? {}) as { unframed?: Record<string, unknown> };
  const unframed: Record<string, unknown> = { ...(meta.unframed ?? {}) };
  if (result.kit === null) delete unframed.kit;
  else unframed.kit = result.kit;
  // Each commit is its own undo step: a stopping point before and after it keeps the next commit out of this one.
  editor.markHistoryStoppingPoint("kit");
  editor.run(() => editor.store.put([{ ...document, meta: { ...meta, unframed } } as never]), { history: "record" });
  editor.markHistoryStoppingPoint("kit");
  return { ok: true };
};
