import type { PointerEvent, ReactNode } from "react";
import { getPointerInfo, useEditor, useValue, type TLShapeId } from "tldraw";
import { noteRender } from "../../fps/renders.ts";
import { pressLabel, renamingShape, startRename } from "../rename.ts";
import { RenameField } from "./RenameField.tsx";
import { shapeLabelClass } from "./looks.ts";

const KIND_WORDS: Readonly<Record<string, string>> = { prompt: "Prompt", group: "Group", image: "Image", video: "Video", page: "Page", motion: "Motion", component: "Component" };

export const ShapeLabel = ({
  shapeId,
  text,
  kind,
  width,
  name,
  after,
  end,
}: {
  readonly shapeId: TLShapeId;
  readonly text: string;
  readonly kind: string;
  readonly width: number;
  readonly name?: string | undefined;
  readonly after?: ReactNode;
  readonly end?: ReactNode;
}) => {
  noteRender(shapeId);
  const editor = useEditor();
  const renaming = useValue("label renaming", () => renamingShape(editor).get() === shapeId, [editor, shapeId]);
  const open = renaming && name !== undefined;
  if (!open && text === "" && !after && !end) return null;

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
      style={open ? undefined : { maxWidth: width }}
      onPointerDown={onPointerDown}
      onPointerUp={(event) => {
        if (open || event.button !== 2 || editor.wasEventAlreadyHandled(event)) return;
        const shape = editor.getShape(shapeId);
        if (!shape) return;
        editor.dispatch({ type: "pointer", name: "pointer_up", target: "shape", shape, ...getPointerInfo(editor, event) });
        event.currentTarget.dispatchEvent(
          new PointerEvent("contextmenu", { bubbles: true, clientX: event.clientX, clientY: event.clientY, button: 2, buttons: 0, pointerId: event.pointerId, pointerType: event.pointerType, isPrimary: event.isPrimary }),
        );
      }}
      onPointerMove={(event) => {
        const shown = event.currentTarget.querySelector<HTMLElement>("[data-label-text]");
        event.currentTarget.title = shown && shown.scrollWidth > shown.clientWidth ? text : "";
      }}
    >
      {open ? (
        <RenameField shapeId={shapeId} current={name} kind={KIND_WORDS[kind] ?? kind} />
      ) : (
        <span data-label-text="" className="min-w-0 truncate">
          {text}
        </span>
      )}
      {!open && after}
      {!open && end !== undefined && <span className="pointer-events-auto ml-auto flex shrink-0 items-center pl-2">{end}</span>}
    </div>
  );
};
