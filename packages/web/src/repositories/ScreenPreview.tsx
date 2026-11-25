import type { ScreenShapeProps } from "@unframed/contracts";
import { useValue } from "tldraw";
import { useCanvasDoc } from "../canvas/doc.ts";
import { useCanvasProject } from "../context.ts";
import { isDeviceClient } from "../deviceMode.ts";
import { useFeature } from "../features.ts";
import { screenPropsOf } from "./BranchChip.tsx";
import { useScreenView, type ScreenEditHooks } from "./ScreenView.tsx";
import { repositoryState } from "./store.ts";

export const ScreenPreview = ({ shapeId, props, edit }: { readonly shapeId: string; readonly props: ScreenShapeProps; readonly edit: ScreenEditHooks }) => {
  const doc = useCanvasDoc();
  const project = useCanvasProject();
  const repositories = useFeature("repositories");
  const state = repositoryState(project);
  const proxyPort = useValue(
    "screen proxy",
    () => {
      const instance = state.instances.get().get(props.instance);
      return instance?.state === "live" ? instance.proxyPort : null;
    },
    [state, props.instance],
  );
  const branch = useValue("screen branch", () => state.instances.get().get(props.instance)?.branch ?? props.title, [state, props.instance, props.title]);
  const live = repositories && !isDeviceClient() && proxyPort !== null;
  const write = (next: ScreenShapeProps) => {
    doc.update(shapeId, { ...next, steps: undefined, mocks: undefined, state: undefined }, "screen navigation");
    return true;
  };
  const view = useScreenView({ owner: doc, project, shapeId, props, live, proxyPort, interactive: true, branch, read: () => screenPropsOf(doc, shapeId), write, edit });
  return (
    <div className="absolute inset-0 overflow-hidden" data-testid="screen-preview" data-route={props.route} data-live={live ? "true" : undefined} data-painted={view.painted ? "true" : undefined}>
      {view.content}
    </div>
  );
};
