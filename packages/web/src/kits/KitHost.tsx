import type { LibraryEntry } from "@unframed/domain";
import { useEffect } from "react";
import { TldrawUiButtonIcon, TldrawUiToolbarButton, useEditor, useValue } from "tldraw";
import { useCanvasDoc } from "../canvas/doc.ts";
import { registerSlot } from "../chrome/slots.ts";
import { LibraryDialog } from "../library/LibraryDialog.tsx";
import { libraryUi } from "../library/state.ts";
import { KitDialog } from "./KitDialog.tsx";
import { UpdateFromKitDialog, useLibraryKit } from "./KitApply.tsx";
import { kitUi } from "./state.ts";

const KitButton = () => {
  const editor = useEditor();
  return (
    <TldrawUiToolbarButton type="tool" title="Kit" tooltip="Kit" onClick={() => kitUi(editor).update((state) => ({ ...state, open: true }))}>
      <TldrawUiButtonIcon icon="palette" />
    </TldrawUiToolbarButton>
  );
};

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

const KitsFromLibrary = () => {
  const doc = useCanvasDoc();
  const open = useValue("library open", () => libraryUi(doc).get().open, [doc]);
  const [applyKit, replaceDialog] = useLibraryKit(doc);
  const close = () => libraryUi(doc).update((state) => ({ ...state, open: false }));
  const add = (entry: LibraryEntry) => {
    close();
    if (entry.kind === "kit") applyKit(entry);
  };
  return (
    <>
      {open && <LibraryDialog onClose={close} onAdd={add} kitsOnly />}
      {replaceDialog}
    </>
  );
};

export const EditorKitHost = () => (
  <>
    <KitDialogs />
    <KitsFromLibrary />
  </>
);
