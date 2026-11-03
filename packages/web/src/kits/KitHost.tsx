/**
 * The Kit on the canvas (spec 19): the Kit button in the bottom bar, beside Library, and the
 * Kit dialog it opens.
 */
import { useEffect } from "react";
import { TldrawUiButtonIcon, TldrawUiToolbarButton, useEditor, useValue } from "tldraw";
import { registerSlot } from "../chrome/slots.ts";
import { libraryUi } from "../library/state.ts";
import { KitDialog } from "./KitDialog.tsx";
import { UpdateFromKitDialog } from "./KitApply.tsx";
import { kitUi } from "./state.ts";

/** The Kit in the bottom bar: a tldraw toolbar button beside Library. */
const KitButton = () => {
  const editor = useEditor();
  return (
    <TldrawUiToolbarButton type="tool" title="Kit" tooltip="Kit" onClick={() => kitUi(editor).update((state) => ({ ...state, open: true }))}>
      <TldrawUiButtonIcon icon="palette" />
    </TldrawUiToolbarButton>
  );
};

export const KitHost = () => {
  const editor = useEditor();
  const open = useValue("kit ui", () => kitUi(editor).get().open, [editor]);
  const merging = useValue("kit merge", () => kitUi(editor).get().merging, [editor]);

  useEffect(() => registerSlot("kitButton", KitButton), []);

  const close = () => kitUi(editor).update((state) => ({ ...state, open: false }));
  const fromLibrary = () => {
    close();
    libraryUi(editor).update((state) => ({ ...state, open: true, type: "kit" }));
  };
  const endMerge = () => kitUi(editor).update((state) => ({ ...state, merging: undefined }));
  return (
    <>
      {open && <KitDialog onClose={close} onFromLibrary={fromLibrary} />}
      {merging !== undefined && <UpdateFromKitDialog editor={editor} preset={merging} onClose={endMerge} />}
    </>
  );
};
