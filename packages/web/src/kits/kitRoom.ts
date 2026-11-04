import { applyKitOps, type Kit, type KitLink, type KitOp } from "@unframed/domain";
import { TLDOCUMENT_ID, type Editor } from "tldraw";

export const kitOf = (editor: Editor): Kit | null => {
  const document = editor.store.get(TLDOCUMENT_ID) as { meta?: { unframed?: { kit?: Kit } } } | undefined;
  return document?.meta?.unframed?.kit ?? null;
};

type KitCommit = { readonly ok: true } | { readonly ok: false; readonly refusal: string };

export const writeKit = (editor: Editor, kit: Kit | null): void => {
  const document = editor.store.get(TLDOCUMENT_ID)!;
  const meta = (document.meta ?? {}) as { unframed?: Record<string, unknown> };
  const unframed: Record<string, unknown> = { ...(meta.unframed ?? {}) };
  if (kit === null) delete unframed.kit;
  else unframed.kit = kit;
  editor.markHistoryStoppingPoint("kit");
  editor.run(() => editor.store.put([{ ...document, meta: { ...meta, unframed } } as never]), { history: "record" });
  editor.markHistoryStoppingPoint("kit");
};

export const commitKit = (editor: Editor, ops: ReadonlyArray<KitOp>): KitCommit => {
  const result = applyKitOps(kitOf(editor), ops);
  if (!result.ok) return { ok: false, refusal: result.refusal };
  writeKit(editor, result.kit);
  return { ok: true };
};

export const linkKit = (editor: Editor, from: KitLink): void => {
  const kit = kitOf(editor);
  if (kit !== null) writeKit(editor, { ...kit, from });
};
