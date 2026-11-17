import { useEffect } from "react";
import { TldrawUiButtonIcon, TldrawUiToolbarButton, useEditor, useValue } from "tldraw";
import { useCanvasDoc } from "../canvas/doc.ts";
import { registerSlot } from "../chrome/slots.ts";
import { libraryUi } from "../library/state.ts";
import { KitDialog } from "./KitDialog.tsx";
import { UpdateFromKitDialog } from "./KitApply.tsx";
import { kitUi } from "./state.ts";

const KitButton = () => {
  const editor = useEditor();
  return (
    <TldrawUiToolbarButton type="tool" title="Kit" tooltip="Kit" onClick={() => kitUi(editor).update((state) => ({ ...state, open: true }))}>
      <TldrawUiButtonIcon icon="palette" />
    </TldrawUiToolbarButton>
  );
};

/** The Kit dialog and its Update from kit dialog, wherever the project is shown: the canvas or an editor tab. */
export const KitDialogs = () => {
  const doc = useCanvasDoc();
  const open = useValue("kit ui", () => kitUi(doc).get().open, [doc]);
  const merging = useValue("kit merge", () => kitUi(doc).get().merging, [doc]);

  const close = () => kitUi(doc).update((state) => ({ ...state, open: false }));
  const fromLibrary = () => {
    close();
    libraryUi(doc).update((state) => ({ ...state, open: true, type: "kit" }));
  };
  const endMerge = () => kitUi(doc).update((state) => ({ ...state, merging: undefined }));
  return (
    <>
      {open && <KitDialog onClose={close} onFromLibrary={fromLibrary} />}
      {merging !== undefined && <UpdateFromKitDialog doc={doc} preset={merging} onClose={endMerge} />}
    </>
  );
};

export const KitHost = () => {
  useEffect(() => registerSlot("kitButton", KitButton), []);
  return <KitDialogs />;
};
