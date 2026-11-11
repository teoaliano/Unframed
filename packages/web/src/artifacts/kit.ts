import type { Kit } from "@unframed/domain";
import { TLDOCUMENT_ID, type Editor } from "tldraw";

export const kitOf = (editor: Editor): Kit | null => {
  const meta = (editor.store.get(TLDOCUMENT_ID)?.meta ?? {}) as { unframed?: { kit?: Kit } };
  return meta.unframed?.kit ?? null;
};
