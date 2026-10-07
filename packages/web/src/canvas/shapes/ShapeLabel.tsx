import type { PointerEvent, ReactNode } from "react";
import { getPointerInfo, useEditor, useValue, type TLShapeId } from "tldraw";
import { noteRender } from "../../fps/renders.ts";
import { pressLabel, renamingShape, startRename } from "../rename.ts";
import { RenameField } from "./RenameField.tsx";
import { shapeLabelClass } from "./looks.ts";

const KIND_WORDS: Readonly<Record<string, string>> = { prompt: "Prompt", group: "Group", image: "Image", video: "Video", page: "Page", motion: "Motion" };

/**
 * The label above a shape's top-left corner, in a 22 px band that is part of the shape and
 * scales with the canvas. Whether it shows is decided by CSS from the canvas's label level
 * and the shape element's `data-label-active` mark. A label is a handle: a press on it
 * presses the shape, and a double-click on it opens the name field in its place, which
 * shows at every zoom. `name` is the `@id` the field starts from; `after` follows the
 * label's text and hides while the field is open.
 */
export const ShapeLabel = ({
  shapeId,
  children,
  kind,
  name,
  after,
}: {
  readonly shapeId: TLShapeId;
  readonly children: ReactNode;
  readonly kind: string;
  readonly name?: string | undefined;
  readonly after?: ReactNode;
}) => {
  noteRender(shapeId);
  const editor = useEditor();
  const renaming = useValue("label renaming", () => renamingShape(editor).get() === shapeId, [editor, shapeId]);
  const open = renaming && name !== undefined;
  // An untitled, unnamed artifact has no label until its name field opens.
  if (!open && (children === "" || children === undefined) && !after) return null;

  const onPointerDown = (event: PointerEvent) => {
    if (open || editor.wasEventAlreadyHandled(event)) return;
    const shape = editor.getShape(shapeId);
    if (!shape) return;
    if (pressLabel(editor, shapeId, event.button)) {
      editor.markEventAsHandled(event);
      event.preventDefault();
      if (name !== undefined) startRename(editor, shapeId);
      return;
    }
    // A filled artifact's frame takes every press inside it, so its label is how it is moved.
    if (event.button === 0) editor.dispatch({ type: "pointer", name: "pointer_down", target: "shape", shape, ...getPointerInfo(editor, event) });
    else if (event.button === 2) editor.dispatch({ type: "pointer", name: "right_click", target: "shape", shape, ...getPointerInfo(editor, event) });
  };

  return (
    <div
      className={shapeLabelClass}
      data-shape-label=""
      data-label-kind={kind}
      data-label-open={open ? "true" : undefined}
      data-label-handle="true"
      onPointerDown={onPointerDown}
    >
      {open ? <RenameField shapeId={shapeId} current={name} kind={KIND_WORDS[kind] ?? kind} /> : children}
      {!open && after}
    </div>
  );
};
