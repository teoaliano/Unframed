/**
 * The project kit as the canvas room holds it (spec 19): `meta.unframed.kit` on the document
 * record. Reactive: a component that reads it through `useValue` follows a kit change.
 */
import type { Kit } from "@unframed/domain";
import { TLDOCUMENT_ID, type Editor } from "tldraw";

export const kitOf = (editor: Editor): Kit | null => {
  const meta = (editor.store.get(TLDOCUMENT_ID)?.meta ?? {}) as { unframed?: { kit?: Kit } };
  return meta.unframed?.kit ?? null;
};
