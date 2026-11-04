import { isArtifactKind } from "@unframed/domain";
import { lazy, Suspense, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useEditor, useValue, type Editor, type TLCamera, type TLShapeId } from "tldraw";
import { registerSlot } from "../chrome/slots.ts";
import { useCanvasProject, useEngine, useSettings } from "../context.ts";
import { closeComposer } from "../generate/state.ts";
import { KitModePicker } from "./KitMode.tsx";
import { ParametersButton } from "./ParametersButton.tsx";
import { RenderButton } from "./render.tsx";
import { artifactsOf, installFrameHold, installTuningWatch, previewPort } from "./state.ts";
import { installImageDrop } from "./imageDrop.tsx";
import { watchComponentPins } from "./componentPins.ts";
import { watchSnapshots } from "./snapshots.ts";

const ArtifactEditor = lazy(() => import("./editor/ArtifactEditor.tsx").then((module) => ({ default: module.ArtifactEditor })));
const ParametersPanel = lazy(() => import("./ParametersPanel.tsx").then((module) => ({ default: module.ParametersPanel })));

interface Opened {
  readonly camera: TLCamera;
}

const saved = new WeakMap<Editor, Opened>();

const openArtifactEditor = (editor: Editor, shapeId: TLShapeId): void => {
  const shape = editor.getShape(shapeId);
  if (!shape || !isArtifactKind(shape.type)) return;
  const state = artifactsOf(editor);
  if (state.editing.get() === undefined) saved.set(editor, { camera: editor.getCamera() });
  editor.select(shapeId);
  closeComposer(editor);
  state.editing.set(shapeId);
};

const closeArtifactEditor = (editor: Editor): void => {
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
      installImageDrop(editor, engine, project),
      watchSnapshots(engine, project),
      watchComponentPins(engine, project),
      registerSlot("openArtifact", openArtifactEditor),
      registerSlot("renderButton", RenderButton),
      registerSlot("parametersButton", ParametersButton),
      registerSlot("kitModeButton", ({ shapeId }: { readonly shapeId: TLShapeId }) => <KitModePicker shapeId={shapeId} variant="toolbar" />),
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

const EditorOverlay = ({ editor, shapeId }: { readonly editor: Editor; readonly shapeId: TLShapeId }) => {
  const host = editor.getContainer().parentElement;
  const close = useCallback(() => closeArtifactEditor(editor), [editor]);

  useEffect(() => {
    host?.setAttribute("data-artifact-editor", "");
    const stopCard = registerSlot("artifactEditorOpen", true);
    editor.blur();
    const stop = editor.store.listen(() => {
      if (editor.getInstanceState().isFocused) editor.blur();
    });
    return () => {
      stop();
      stopCard();
      host?.removeAttribute("data-artifact-editor");
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
