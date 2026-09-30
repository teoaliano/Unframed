/**
 * The library on the canvas (spec 06): the Library button in its chrome slot, the "Add to
 * library" handler the context menu calls, and the two dialogs they open.
 */
import { UnframedError } from "@unframed/contracts";
import type { Preset } from "@unframed/domain";
import { useEffect } from "react";
import { TldrawUiButtonIcon, TldrawUiToolbarButton, useEditor, useValue } from "tldraw";
import { registerSlot } from "../chrome/slots.ts";
import { useCanvasProject, useEngine, useSettings } from "../context.ts";
import { showError } from "../toasts.tsx";
import { AddToLibraryDialog } from "./AddToLibraryDialog.tsx";
import { insertPreset } from "./insertPreset.ts";
import { LibraryDialog } from "./LibraryDialog.tsx";
import { captureSelection, libraryUi } from "./state.ts";

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

export const LIBRARY_TOOLTIP = "Ready-made flows and styles";

/** The Library in the bottom bar: a tldraw toolbar button beside the tools. */
const LibraryButton = () => {
  const editor = useEditor();
  return (
    <TldrawUiToolbarButton type="tool" title="Library" tooltip={LIBRARY_TOOLTIP} onClick={() => libraryUi(editor).update((state) => ({ ...state, open: true }))}>
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

  const add = (preset: Preset) => {
    libraryUi(editor).update((state) => ({ ...state, open: false }));
    insertPreset({ editor, engine, project, preset, textModel: settings?.textModel }).catch((error: unknown) => showError(messageOf(error)));
  };

  return (
    <>
      {ui.open && <LibraryDialog onClose={() => libraryUi(editor).update((state) => ({ ...state, open: false }))} onAdd={add} />}
      {ui.saving && <AddToLibraryDialog captured={ui.saving} onClose={() => libraryUi(editor).update((state) => ({ ...state, saving: undefined }))} />}
    </>
  );
};
