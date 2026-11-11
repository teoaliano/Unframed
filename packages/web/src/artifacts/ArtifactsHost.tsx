import type { ArtifactShapeProps } from "@unframed/contracts";
import { artifactTitle, editorTabKey, editorTabsOf, isArtifactKind, shapeOfTab, type ArtifactKind } from "@unframed/domain";
import { lazy, Suspense, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { atom, react, useEditor, useValue, type Editor, type TLCamera, type TLShapeId } from "tldraw";
import { registerSlot } from "../chrome/slots.ts";
import { useActivation, useCanvasProject, useEngine, useSettings } from "../context.ts";
import { isDeviceClient, useIsDevice } from "../deviceMode.ts";
import type { ProjectActivation } from "../project/activation.ts";
import { showNotice } from "../toasts.tsx";
import { closeComposer } from "../generate/state.ts";
import { KitModePicker } from "./KitMode.tsx";
import { ParametersButton } from "./ParametersButton.tsx";
import { RenderButton } from "./render.tsx";
import { artifactsOf, installFrameHold, installTuningWatch, previewPort } from "./state.ts";
import { installImageDrop } from "./imageDrop.tsx";
import { watchComponentPins } from "./componentPins.ts";
import { applyLateSaves } from "./editor/lateSaves.ts";
import { watchFileChanges, watchSnapshots } from "./snapshots.ts";
import { ScaleMenu } from "./ScaleMenu.tsx";

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

const aboutShape = (editor: Editor, shapeId: TLShapeId): { readonly title: string; readonly kind: ArtifactKind } | undefined => {
  const shape = editor.getShape(shapeId);
  if (!shape || !isArtifactKind(shape.type)) return undefined;
  return { title: artifactTitle(shape.props as ArtifactShapeProps), kind: shape.type };
};

const EDITOR_ON_MAC = "Open this on your Mac to edit or play it.";

const openArtifactTab = (activation: ProjectActivation, project: string) => (editor: Editor, shapeId: TLShapeId) => {
  if (isDeviceClient()) {
    if (aboutShape(editor, shapeId)) showNotice(EDITOR_ON_MAC, "info");
    return;
  }
  const about = aboutShape(editor, shapeId);
  if (about) void activation.openEditor(project, shapeId, about);
};

const watchEditorTabs = (editor: Editor, activation: ProjectActivation, project: string): (() => void) => {
  const sync = () => {
    const state = activation.tabState();
    if (state.active !== project) return;
    const wanted = state.editing === undefined ? undefined : (shapeOfTab(state.editing) as TLShapeId | undefined);
    if (wanted === undefined) closeArtifactEditor(editor);
    else if (!editor.getShape(wanted)) queueMicrotask(() => void activation.closeTab(state.editing!, { remember: false }));
    else if (artifactsOf(editor).editing.get() !== wanted) openArtifactEditor(editor, wanted);
  };
  const tabState = atom("editor tabs", activation.tabState());
  sync();
  const stopTabs = activation.subscribe(() => {
    tabState.set(activation.tabState());
    sync();
  });
  const stopShapes = react("editor tabs follow their artifacts", () => {
    const state = tabState.get();
    if (state.active !== project) return;
    for (const key of editorTabsOf(state.order, project)) {
      const about = aboutShape(editor, shapeOfTab(key) as TLShapeId);
      if (about === undefined) queueMicrotask(() => void activation.closeTab(key, { remember: false }));
      else queueMicrotask(() => activation.describeEditor(key, about));
    }
  });
  return () => {
    stopTabs();
    stopShapes();
  };
};

export const ArtifactsHost = () => {
  const editor = useEditor();
  const engine = useEngine();
  const project = useCanvasProject();
  const settings = useSettings();
  const activation = useActivation();
  const device = useIsDevice();

  useEffect(() => {
    if (settings) previewPort.set(settings.previewPort);
  }, [settings]);

  useEffect(() => {
    artifactsOf(editor).project.set(project);
    applyLateSaves(editor, project);
    const stops = [
      installFrameHold(editor),
      installImageDrop(editor, engine, project),
      watchSnapshots(engine, project),
      watchFileChanges(engine, project),
      watchComponentPins(engine, project),
      registerSlot("openArtifact", openArtifactTab(activation, project)),
      registerSlot("renderButton", RenderButton),
      ...(device ? [] : [registerSlot("parametersButton", ParametersButton)]),
      registerSlot("scaleButton", ScaleMenu),
      registerSlot("kitModeButton", ({ shapeId }: { readonly shapeId: TLShapeId }) => <KitModePicker shapeId={shapeId} variant="toolbar" />),
      installTuningWatch(editor),
      watchEditorTabs(editor, activation, project),
    ];
    return () => {
      for (const stop of stops) stop();
      closeArtifactEditor(editor);
    };
  }, [editor, engine, project, activation, device]);

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
  const open = useCallback((id: string) => openArtifactTab(activation, project)(editor, id as TLShapeId), [editor, activation, project]);

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
