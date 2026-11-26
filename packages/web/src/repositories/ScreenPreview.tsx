import type { ScreenShapeProps } from "@unframed/contracts";
import { useRef } from "react";
import { useCanvasDoc } from "../canvas/doc.ts";
import { useCanvasProject } from "../context.ts";
import { useScreenSlot } from "./framePool.tsx";
import { ScreenPlaceholder, type ScreenEditHooks } from "./ScreenView.tsx";

const FIRST = { selected: true, distance: 0 };

export const ScreenPreview = ({ shapeId, props, edit }: { readonly shapeId: string; readonly props: ScreenShapeProps; readonly edit: ScreenEditHooks }) => {
  const doc = useCanvasDoc();
  const project = useCanvasProject();
  const element = useRef<HTMLDivElement>(null);
  const write = (next: ScreenShapeProps) => {
    doc.update(shapeId, { ...next, steps: undefined, mocks: undefined, state: undefined }, "screen navigation");
    return true;
  };
  const status = useScreenSlot(project, shapeId, {
    element,
    clip: () => element.current?.parentElement ?? null,
    owner: doc,
    props,
    interactive: true,
    selected: false,
    editor: true,
    write,
    rank: () => FIRST,
    edit,
  });
  return (
    <div ref={element} className="absolute inset-0 overflow-hidden" data-testid="screen-preview" data-route={props.route} data-live={status.live ? "true" : undefined} data-painted={status.painted ? "true" : undefined}>
      <ScreenPlaceholder project={project} shapeId={shapeId} props={props} status={status} />
    </div>
  );
};
