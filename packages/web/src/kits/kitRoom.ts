import { applyKitOps, type Kit, type KitLink, type KitOp } from "@unframed/domain";
import type { CanvasDoc } from "../canvas/doc.ts";

export const kitOf = (doc: CanvasDoc): Kit | null => doc.kit();

type KitCommit = { readonly ok: true } | { readonly ok: false; readonly refusal: string };

export const writeKit = (doc: CanvasDoc, kit: Kit | null): void => {
  const meta = doc.documentMeta();
  const unframed: Record<string, unknown> = { ...((meta.unframed as Record<string, unknown> | undefined) ?? {}) };
  if (kit === null) delete unframed.kit;
  else unframed.kit = kit;
  doc.setDocumentMeta({ ...meta, unframed }, "kit");
};

export const commitKit = (doc: CanvasDoc, ops: ReadonlyArray<KitOp>): KitCommit => {
  const result = applyKitOps(kitOf(doc), ops);
  if (!result.ok) return { ok: false, refusal: result.refusal };
  writeKit(doc, result.kit);
  return { ok: true };
};

export const linkKit = (doc: CanvasDoc, from: KitLink): void => {
  const kit = kitOf(doc);
  if (kit !== null) writeKit(doc, { ...kit, from });
};
