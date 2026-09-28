import type { ReactNode } from "react";
import { useEditor, useValue, type TLShapeId } from "tldraw";

/**
 * The label above a shape's top-left corner, in a 22 px band that is part of the shape and
 * scales with the canvas. Whether it shows is decided by CSS from the canvas's label level;
 * this only marks it active while its shape is hovered or selected, a primitive per shape.
 */
export const ShapeLabel = ({ shapeId, children, kind }: { readonly shapeId: TLShapeId; readonly children: ReactNode; readonly kind: string }) => {
  const editor = useEditor();
  const active = useValue(
    "label active",
    () => editor.getHoveredShapeId() === shapeId || editor.getSelectedShapeIds().includes(shapeId),
    [editor, shapeId],
  );
  return (
    <div className="unframed-shape-label" data-label-kind={kind} data-active={active ? "true" : undefined}>
      {children}
    </div>
  );
};
