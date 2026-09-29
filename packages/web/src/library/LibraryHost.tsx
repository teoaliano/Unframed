/**
 * The library on the canvas (spec 06): the Library button in its chrome slot, the "Add to
 * library" handler the context menu calls, and the two dialogs they open.
 */
import { UnframedError } from "@unframed/contracts";
import type { Preset } from "@unframed/domain";
import { Library } from "lucide-react";
import { useEffect } from "react";
import { useEditor, useValue } from "tldraw";
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
      <button
        type="button"
        aria-label="Library"
        className="flex size-12 cursor-pointer items-center justify-center rounded-container border border-line bg-[var(--unframed-card-translucent)] p-0 text-icon shadow-chrome backdrop-blur-[var(--unframed-chrome-blur)] hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={() => libraryUi(editor).update((state) => ({ ...state, open: true }))}
      >
        <Library size={20} aria-hidden />
      </button>
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
