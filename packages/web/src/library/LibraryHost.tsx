/**
 * The library on the canvas (spec 06): the Library button in its chrome slot, the "Add to
 * library" handler the context menu calls, and the two dialogs they open.
 */
import { UnframedError } from "@unframed/contracts";
import type { Preset } from "@unframed/domain";
import { Library } from "lucide-react";
import { useEffect } from "react";
import { useEditor, useValue } from "tldraw";
import { Button } from "~/components/ui/button";
import { registerSlot } from "../chrome/slots.ts";
import { Tip } from "../chrome/ui.tsx";
import { useCanvasProject, useEngine, useSettings } from "../context.ts";
import { showError } from "../toasts.tsx";
import { AddToLibraryDialog } from "./AddToLibraryDialog.tsx";
import { insertPreset } from "./insertPreset.ts";
import { LibraryDialog } from "./LibraryDialog.tsx";
import { captureSelection, libraryUi } from "./state.ts";

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

export const LIBRARY_TOOLTIP = "Ready-made flows and styles";

const LibraryButton = () => {
  const editor = useEditor();
  return (
    <Tip label={LIBRARY_TOOLTIP} side="left">
      <Button variant="ghost" size="icon-lg" aria-label="Library" onClick={() => libraryUi(editor).update((state) => ({ ...state, open: true }))}>
        <Library aria-hidden />
      </Button>
    </Tip>
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
