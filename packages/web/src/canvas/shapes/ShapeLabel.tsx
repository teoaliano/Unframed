import type { PointerEvent, ReactNode } from "react";
import type { TLShapeId } from "tldraw";
import { noteRender } from "../../fps/renders.ts";

/**
 * The label above a shape's top-left corner, in a 22 px band that is part of the shape and
 * scales with the canvas. Whether it shows is decided by CSS from the canvas's label level
 * and the shape element's `data-label-active` mark, so it subscribes to nothing. An `active`
 * label (a group's name field) shows at every zoom.
 */
export const ShapeLabel = ({
  shapeId,
  children,
  kind,
  active,
  onPointerDown,
}: {
  readonly shapeId: TLShapeId;
  readonly children: ReactNode;
  readonly kind: string;
  readonly active?: boolean;
  /** A label that is also a handle (an artifact's title) takes the press. */
  readonly onPointerDown?: (event: PointerEvent) => void;
}) => {
  noteRender(shapeId);
  return (
    <div
      className="unframed-shape-label"
      data-label-kind={kind}
      data-label-open={active ? "true" : undefined}
      data-label-handle={onPointerDown ? "true" : undefined}
      {...(onPointerDown ? { onPointerDown } : {})}
    >
      {children}
    </div>
  );
};
