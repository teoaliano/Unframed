/**
 * Artifacts on the canvas (spec 09): the editor's entry point (double-click, the toolbar's Open and the recap card's Open all call it), the
 * canvas Parameters panel, the frame hold, the snapshot stream and the preview origin's port.
 */
import { isArtifactKind } from "@unframed/domain";
import { lazy, Suspense, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useEditor, useValue, type Editor, type TLCamera, type TLShapeId } from "tldraw";
import { registerSlot } from "../chrome/slots.ts";
import { useCanvasProject, useEngine, useSettings } from "../context.ts";
import { closeComposer } from "../generate/state.ts";
import { ParametersButton } from "./ParametersButton.tsx";
import { RenderButton } from "./render.tsx";
import { artifactsOf, installFrameHold, installTuningWatch, previewPort } from "./state.ts";
import { watchSnapshots } from "./snapshots.ts";

// Loaded with the editor or the first Parameters panel only: DialKit and its stylesheet never reach a board where neither opens.
const ArtifactEditor = lazy(() => import("./editor/ArtifactEditor.tsx").then((module) => ({ default: module.ArtifactEditor })));
const ParametersPanel = lazy(() => import("./ParametersPanel.tsx").then((module) => ({ default: module.ParametersPanel })));

/** What opening the editor saved, to put back on close. */
interface Opened {
  readonly camera: TLCamera;
}

const saved = new WeakMap<Editor, Opened>();

/** Opens the editor on one artifact: saves the camera, selects it alone, closes the composer, then shows the editor. */
export const openArtifactEditor = (editor: Editor, shapeId: TLShapeId): void => {
  const shape = editor.getShape(shapeId);
  if (!shape || !isArtifactKind(shape.type)) return;
  const state = artifactsOf(editor);
  if (state.editing.get() === undefined) saved.set(editor, { camera: editor.getCamera() });
  editor.select(shapeId);
  closeComposer(editor);
  state.editing.set(shapeId);
};

/** Closes the editor and puts the camera back exactly where it was. */
export const closeArtifactEditor = (editor: Editor): void => {
  const state = artifactsOf(editor);
  if (state.editing.get() === undefined) return;
  state.editing.set(undefined);
  const opened = saved.get(editor);
  saved.delete(editor);
  if (opened) editor.setCamera(opened.camera, { immediate: true, force: true });
};

export const ArtifactsHost = () => {
  const editor = useEditor();
  const engine = useEngine();
  const project = useCanvasProject();
  const settings = useSettings();

  useEffect(() => {
    if (settings) previewPort.set(settings.previewPort);
  }, [settings]);

  useEffect(() => {
    artifactsOf(editor).project.set(project);
    const stops = [
      installFrameHold(editor),
      watchSnapshots(engine, project),
      registerSlot("openArtifact", openArtifactEditor),
      registerSlot("renderButton", RenderButton),
      registerSlot("parametersButton", ParametersButton),
      installTuningWatch(editor),
    ];
    return () => {
      for (const stop of stops) stop();
      closeArtifactEditor(editor);
    };
  }, [editor, engine, project]);

  const editing = useValue("editing artifact", () => artifactsOf(editor).editing.get(), [editor]);
  const tuning = useValue("tuning artifact", () => artifactsOf(editor).tuning.get(), [editor]);
  return (
    <>
      {tuning !== undefined && (
        <Suspense fallback={null}>
          <ParametersPanel key={tuning} shapeId={tuning} />
        </Suspense>
      )}
      {editing !== undefined && <EditorOverlay editor={editor} shapeId={editing} />}
    </>
  );
};

/**
 * The editor replaces the canvas on screen while it is open. The tldraw editor and its
 * undo history stay mounted beneath it, blurred, so none of its shortcuts runs.
 */
const EditorOverlay = ({ editor, shapeId }: { readonly editor: Editor; readonly shapeId: TLShapeId }) => {
  const host = editor.getContainer().parentElement;
  const close = useCallback(() => closeArtifactEditor(editor), [editor]);

  useEffect(() => {
    host?.setAttribute("data-artifact-editor", "");
    editor.blur();
    // Keep the canvas out of the keyboard's way for as long as the editor is open.
    const stop = editor.store.listen(() => {
      if (editor.getInstanceState().isFocused) editor.blur();
    });
    return () => {
      stop();
      host?.removeAttribute("data-artifact-editor");
      // Back on the canvas, the keyboard is the canvas's again: Cmd-Z undoes a dial change.
      if (!editor.isDisposed) editor.focus();
    };
  }, [editor, host]);

  const overlay = (
    <Suspense fallback={null}>
      <ArtifactEditor shapeId={shapeId} onClose={close} onOpen={(id) => openArtifactEditor(editor, id as TLShapeId)} />
    </Suspense>
  );
  return host ? createPortal(overlay, host) : overlay;
};
