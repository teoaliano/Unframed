import { lazy, Suspense, useEffect } from "react";
import { useEditor, useValue, type Editor, type TLShapeId } from "tldraw";
import { useCanvasDoc } from "../canvas/doc.ts";
import { registerSlot } from "../chrome/slots.ts";
import { useActivation, useCanvasProject, useEngine } from "../context.ts";
import { isDeviceClient, useIsDevice } from "../deviceMode.ts";
import { closeComposer } from "../generate/state.ts";
import { KitModePicker } from "./KitMode.tsx";
import { ParametersButton } from "./ParametersButton.tsx";
import { RenderButton } from "./render.tsx";
import { artifactsOf, installFrameHold, installTuningWatch } from "./state.ts";
import { installImageDrop } from "./imageDrop.tsx";
import { aboutShape, openArtifactTab } from "./editorTabs.ts";
import { ScaleMenu } from "./ScaleMenu.tsx";
import { useFeature } from "../features.ts";

const ParametersPanel = lazy(() => import("./ParametersPanel.tsx").then((module) => ({ default: module.ParametersPanel })));

export const ArtifactsHost = () => {
  const editor = useEditor();
  const doc = useCanvasDoc();
  const engine = useEngine();
  const project = useCanvasProject();
  const activation = useActivation();
  const device = useIsDevice();
  const elementEditing = useFeature("element-editing");

  useEffect(() => {
    const open = (from: Editor, shapeId: TLShapeId) => {
      if (!isDeviceClient() && aboutShape(doc, shapeId)) {
        from.select(shapeId);
        closeComposer(from);
      }
      openArtifactTab(doc, activation, project, shapeId);
    };
    const stops = [
      installFrameHold(editor),
      ...(elementEditing ? [installImageDrop(editor, engine, project)] : []),
      registerSlot("openArtifact", open),
      registerSlot("renderButton", RenderButton),
      ...(device ? [] : [registerSlot("parametersButton", ParametersButton)]),
      registerSlot("scaleButton", ScaleMenu),
      registerSlot("kitModeButton", ({ shapeId }: { readonly shapeId: TLShapeId }) => <KitModePicker shapeId={shapeId} variant="toolbar" />),
      installTuningWatch(editor),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [editor, doc, engine, project, activation, device, elementEditing]);

  const tuning = useValue("tuning artifact", () => artifactsOf(editor).tuning.get(), [editor]);
  return (
    tuning !== undefined && (
      <Suspense fallback={null}>
        <ParametersPanel key={tuning} shapeId={tuning} />
      </Suspense>
    )
  );
};
