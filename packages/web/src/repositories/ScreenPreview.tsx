import type { ScreenShapeProps } from "@unframed/contracts";
import { useCanvasDoc } from "../canvas/doc.ts";
import { useCanvasProject } from "../context.ts";
import { useScreenView, type ScreenEditHooks } from "./ScreenView.tsx";

export const ScreenPreview = ({ shapeId, props, edit }: { readonly shapeId: string; readonly props: ScreenShapeProps; readonly edit: ScreenEditHooks }) => {
  const doc = useCanvasDoc();
  const project = useCanvasProject();
  const write = (next: ScreenShapeProps) => {
    doc.update(shapeId, { ...next, steps: undefined, mocks: undefined, state: undefined }, "screen navigation");
    return true;
  };
  const view = useScreenView({ owner: doc, project, shapeId, props, onScreen: true, interactive: true, write, edit });
  return (
    <div className="absolute inset-0 overflow-hidden" data-testid="screen-preview" data-route={props.route} data-live={view.live ? "true" : undefined} data-painted={view.painted ? "true" : undefined}>
      {view.content}
    </div>
  );
};
