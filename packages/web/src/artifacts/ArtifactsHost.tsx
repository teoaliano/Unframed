import { editorTabKey, isArtifactKind, shapeOfTab } from "@unframed/domain";
import { lazy, Suspense, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useEditor, useValue, type Editor, type TLCamera, type TLShapeId } from "tldraw";
import { useCanvasDoc } from "../canvas/doc.ts";
import { registerSlot } from "../chrome/slots.ts";
import { useActivation, useCanvasProject, useEngine } from "../context.ts";
import { useIsDevice } from "../deviceMode.ts";
import type { ProjectActivation } from "../project/activation.ts";
import { closeComposer } from "../generate/state.ts";
import { KitModePicker } from "./KitMode.tsx";
import { ParametersButton } from "./ParametersButton.tsx";
import { RenderButton } from "./render.tsx";
import { artifactsOf, installFrameHold, installTuningWatch } from "./state.ts";
import { installImageDrop } from "./imageDrop.tsx";
import { openArtifactTab } from "./editorTabs.ts";
import { ScaleMenu } from "./ScaleMenu.tsx";
import { useFeature } from "../features.ts";

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

const watchEditing = (editor: Editor, activation: ProjectActivation, project: string): (() => void) => {
  const sync = () => {
    const state = activation.tabState();
    if (state.active !== project) return;
    const wanted = state.editing === undefined ? undefined : (shapeOfTab(state.editing) as TLShapeId | undefined);
    if (wanted === undefined || !editor.getShape(wanted)) closeArtifactEditor(editor);
    else if (artifactsOf(editor).editing.get() !== wanted) openArtifactEditor(editor, wanted);
  };
  sync();
  return activation.subscribe(sync);
};

export const ArtifactsHost = () => {
  const editor = useEditor();
  const doc = useCanvasDoc();
  const engine = useEngine();
  const project = useCanvasProject();
  const activation = useActivation();
  const device = useIsDevice();
  const elementEditing = useFeature("element-editing");

  useEffect(() => {
    const stops = [
      installFrameHold(editor),
      ...(elementEditing ? [installImageDrop(editor, engine, project)] : []),
      registerSlot("openArtifact", (_editor: Editor, shapeId: TLShapeId) => openArtifactTab(doc, activation, project, shapeId)),
      registerSlot("renderButton", RenderButton),
      ...(device ? [] : [registerSlot("parametersButton", ParametersButton)]),
      registerSlot("scaleButton", ScaleMenu),
      registerSlot("kitModeButton", ({ shapeId }: { readonly shapeId: TLShapeId }) => <KitModePicker shapeId={shapeId} variant="toolbar" />),
      installTuningWatch(editor),
      watchEditing(editor, activation, project),
    ];
    return () => {
      for (const stop of stops) stop();
      closeArtifactEditor(editor);
    };
  }, [editor, doc, engine, project, activation, device, elementEditing]);

  const editing = useValue("editing artifact", () => artifactsOf(editor).editing.get(), [editor]);
  const tuning = useValue("tuning artifact", () => artifactsOf(editor).tuning.get(), [editor]);
  return (
    <>
      {tuning !== undefined && (
        <Suspense fallback={null}>
          <ParametersPanel key={tuning} shapeId={tuning} />
        </Suspense>
      )}
      {editing !== undefined && <EditorOverlay editor={editor} shapeId={editing} activation={activation} project={project} />}
    </>
  );
};

const EditorOverlay = ({
  editor,
  shapeId,
  activation,
  project,
}: {
  readonly editor: Editor;
  readonly shapeId: TLShapeId;
  readonly activation: ProjectActivation;
  readonly project: string;
}) => {
  const host = editor.getContainer().parentElement;
  const close = useCallback(() => {
    if (editor.getShape(shapeId)) void activation.activate(project);
    else void activation.closeTab(editorTabKey(project, shapeId), { remember: false });
  }, [editor, shapeId, activation, project]);
  const doc = useCanvasDoc();
  const open = useCallback((id: string) => openArtifactTab(doc, activation, project, id), [doc, activation, project]);

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
      <ArtifactEditor shapeId={shapeId} onClose={close} onOpen={open} onLeave={(commit) => activation.setBeforeLeave(commit)} />
    </Suspense>
  );
  return host ? createPortal(overlay, host) : overlay;
};
