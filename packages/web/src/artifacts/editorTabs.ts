import type { ArtifactShapeProps } from "@unframed/contracts";
import { artifactTitle, editorTabsOf, isArtifactKind, shapeOfTab, type ArtifactKind } from "@unframed/domain";
import { atom, react } from "tldraw";
import type { CanvasDoc } from "../canvas/doc.ts";
import { isDeviceClient } from "../deviceMode.ts";
import type { ProjectActivation } from "../project/activation.ts";
import { showNotice } from "../toasts.tsx";

export const aboutShape = (doc: CanvasDoc, shapeId: string): { readonly title: string; readonly kind: ArtifactKind } | undefined => {
  const shape = doc.shape(shapeId);
  if (!shape || !isArtifactKind(shape.type)) return undefined;
  return { title: artifactTitle(shape.props as ArtifactShapeProps), kind: shape.type };
};

const EDITOR_ON_MAC = "Open this on your Mac to edit or play it.";

export const openArtifactTab = (doc: CanvasDoc, activation: ProjectActivation, project: string, shapeId: string): void => {
  const about = aboutShape(doc, shapeId);
  if (about === undefined) return;
  if (isDeviceClient()) showNotice(EDITOR_ON_MAC, "info");
  else void activation.openEditor(project, shapeId, about);
};

export const watchEditorTabs = (doc: CanvasDoc, activation: ProjectActivation, project: string): (() => void) => {
  const tabState = atom("editor tabs", activation.tabState());
  const stopTabs = activation.subscribe(() => tabState.set(activation.tabState()));
  const stopShapes = react("editor tabs follow their artifacts", () => {
    const state = tabState.get();
    if (state.active !== project) return;
    for (const key of editorTabsOf(state.order, project)) {
      const about = aboutShape(doc, shapeOfTab(key)!);
      if (about === undefined) queueMicrotask(() => void activation.closeTab(key, { remember: false }));
      else queueMicrotask(() => activation.describeEditor(key, about));
    }
  });
  return () => {
    stopTabs();
    stopShapes();
  };
};
