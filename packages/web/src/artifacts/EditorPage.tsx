import { editorTabKey } from "@unframed/domain";
import { lazy, Suspense, useCallback, useEffect } from "react";
import { useCanvasDoc } from "../canvas/doc.ts";
import { registerSlot } from "../chrome/slots.ts";
import { EditorKitHost } from "../kits/KitHost.tsx";
import { useActivation, useCanvasProject } from "../context.ts";
import { openArtifactTab } from "./editorTabs.ts";

const ArtifactEditor = lazy(() => import("./editor/ArtifactEditor.tsx").then((module) => ({ default: module.ArtifactEditor })));

export const EditorPage = ({ shapeId }: { readonly shapeId: string }) => {
  const doc = useCanvasDoc();
  const activation = useActivation();
  const project = useCanvasProject();
  const close = useCallback(() => {
    if (doc.shape(shapeId)) void activation.activate(project);
    else void activation.closeTab(editorTabKey(project, shapeId), { remember: false });
  }, [doc, shapeId, activation, project]);
  const open = useCallback((id: string) => openArtifactTab(doc, activation, project, id), [doc, activation, project]);
  const leave = useCallback((commit: () => Promise<void>) => activation.setBeforeLeave(commit), [activation]);

  useEffect(() => registerSlot("artifactEditorOpen", true), []);
  useEffect(() => doc.select([shapeId]), [doc, shapeId]);

  return (
    <>
      <Suspense fallback={null}>
        <ArtifactEditor shapeId={shapeId} onClose={close} onOpen={open} onLeave={leave} />
      </Suspense>
      <EditorKitHost />
    </>
  );
};
