import type { ReactNode } from "react";
import type { TLShapeId } from "tldraw";
import { noteRender } from "../../fps/renders.ts";

/**
 * The label above a shape's top-left corner, in a 22 px band that is part of the shape and
 * scales with the canvas. Whether it shows is decided by CSS from the canvas's label level
 * and the shape element's `data-label-active` mark, so it subscribes to nothing.
 */
export const ShapeLabel = ({ shapeId, children, kind }: { readonly shapeId: TLShapeId; readonly children: ReactNode; readonly kind: string }) => {
  noteRender(shapeId);
  return (
    <div className="unframed-shape-label" data-label-kind={kind}>
      {children}
    </div>
  );
};
