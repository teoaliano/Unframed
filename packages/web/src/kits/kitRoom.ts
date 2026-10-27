/**
 * The project kit in the canvas room (spec 19): read from the document record, and written
 * as one history step per commit. Every change goes through the domain's `applyKitOps`.
 */
import { applyKitOps, type Kit, type KitLink, type KitOp } from "@unframed/domain";
import { TLDOCUMENT_ID, type Editor } from "tldraw";

/** The project's kit, or null when it has none. */
export const kitOf = (editor: Editor): Kit | null => {
  const document = editor.store.get(TLDOCUMENT_ID) as { meta?: { unframed?: { kit?: Kit } } } | undefined;
  return document?.meta?.unframed?.kit ?? null;
};

export type KitCommit = { readonly ok: true } | { readonly ok: false; readonly refusal: string };

/** Writes the kit (null removes it) to the room as one undo step. Each write is its own step. */
export const writeKit = (editor: Editor, kit: Kit | null): void => {
  const document = editor.store.get(TLDOCUMENT_ID)!;
  const meta = (document.meta ?? {}) as { unframed?: Record<string, unknown> };
  const unframed: Record<string, unknown> = { ...(meta.unframed ?? {}) };
  if (kit === null) delete unframed.kit;
  else unframed.kit = kit;
  // A stopping point before and after keeps one write out of the next one's undo step.
  editor.markHistoryStoppingPoint("kit");
  editor.run(() => editor.store.put([{ ...document, meta: { ...meta, unframed } } as never]), { history: "record" });
  editor.markHistoryStoppingPoint("kit");
};

/** Applies the ops to the room's kit and writes the result. A refusal writes nothing. */
export const commitKit = (editor: Editor, ops: ReadonlyArray<KitOp>): KitCommit => {
  const result = applyKitOps(kitOf(editor), ops);
  if (!result.ok) return { ok: false, refusal: result.refusal };
  writeKit(editor, result.kit);
  return { ok: true };
};

/** Sets the link to the library kit the project took or saved (spec 19), in one write. */
export const linkKit = (editor: Editor, from: KitLink): void => {
  const kit = kitOf(editor);
  if (kit !== null) writeKit(editor, { ...kit, from });
};
