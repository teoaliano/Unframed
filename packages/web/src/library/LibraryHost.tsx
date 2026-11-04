import { UnframedError } from "@unframed/contracts";
import type { KitPreset, LibraryEntry } from "@unframed/domain";
import { useEffect, useState } from "react";
import { TldrawUiButtonIcon, TldrawUiToolbarButton, useEditor, useValue } from "tldraw";
import { registerSlot } from "../chrome/slots.ts";
import { useCanvasProject, useEngine, useSettings } from "../context.ts";
import { showError } from "../toasts.tsx";
import { AddToLibraryDialog } from "./AddToLibraryDialog.tsx";
import { applyLibraryKit, ReplaceKitDialog } from "../kits/KitApply.tsx";
import { insertPreset } from "./insertPreset.ts";
import { LibraryDialog } from "./LibraryDialog.tsx";
import { captureSelection, libraryUi } from "./state.ts";

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

const LIBRARY_TOOLTIP = "Ready-made flows and styles";

const LibraryButton = () => {
  const editor = useEditor();
  return (
    <TldrawUiToolbarButton type="tool" title="Library" tooltip={LIBRARY_TOOLTIP} onClick={() => libraryUi(editor).update((state) => ({ ...state, open: true, type: undefined }))}>
      <TldrawUiButtonIcon icon="library" />
    </TldrawUiToolbarButton>
  );
};

export const LibraryHost = () => {
  const editor = useEditor();
  const engine = useEngine();
  const project = useCanvasProject();
  const settings = useSettings();
  const ui = useValue("library", () => libraryUi(editor).get(), [editor]);
  const [replacing, setReplacing] = useState<KitPreset>();

  useEffect(() => {
    const stopButton = registerSlot("libraryButton", LibraryButton);
    const stopHandler = registerSlot("addToLibrary", (target) => {
      const captured = captureSelection(target, project);
      if (captured) libraryUi(target).update((state) => ({ ...state, saving: captured }));
    });
    return () => {
      stopButton();
      stopHandler();
    };
  }, [project]);

  const add = (entry: LibraryEntry) => {
    libraryUi(editor).update((state) => ({ ...state, open: false }));
    if (entry.kind === "kit") {
      applyLibraryKit(editor, entry, () => setReplacing(entry));
      return;
    }
    insertPreset({ editor, engine, project, preset: entry, textModel: settings?.textModel }).catch((error: unknown) => showError(messageOf(error)));
  };

  return (
    <>
      {ui.open && <LibraryDialog onClose={() => libraryUi(editor).update((state) => ({ ...state, open: false }))} onAdd={add} initialType={ui.type ?? "all"} />}
      {replacing !== undefined && <ReplaceKitDialog editor={editor} preset={replacing} onClose={() => setReplacing(undefined)} />}
      {ui.saving && <AddToLibraryDialog captured={ui.saving} onClose={() => libraryUi(editor).update((state) => ({ ...state, saving: undefined }))} />}
    </>
  );
};
