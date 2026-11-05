import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { useEditor, useValue, type Editor, type TLShape, type TLShapeId } from "tldraw";
import { Tip } from "../chrome/ui.tsx";
import { connectWire } from "./operations.ts";

const NO_HANDLE = new Set(["wire", "audio", "component", "arrow"]);

const handleFor = (editor: Editor, held: TLShapeId | undefined): { id: TLShapeId; x: number; y: number } | undefined => {
  const id = held ?? editor.getOnlySelectedShapeId() ?? undefined;
  if (id === undefined) return undefined;
  const shape: TLShape | undefined = editor.getShape(id);
  if (!shape || NO_HANDLE.has(shape.type) || editor.isInAny("select.translating", "select.resizing", "select.rotating", "select.brushing", "hand.dragging")) return undefined;
  const bounds = editor.getShapePageBounds(id);
  if (!bounds) return undefined;
  const point = editor.pageToViewport({ x: bounds.maxX, y: bounds.midY });
  return { id, x: point.x, y: point.y };
};

export const WireHandles = () => {
  const editor = useEditor();
  const [held, setHeld] = useState<TLShapeId>();
  const [drag, setDrag] = useState<{ from: TLShapeId; start: { x: number; y: number }; at: { x: number; y: number } }>();
  const handle = useValue("wire handle", () => handleFor(editor, held), [editor, held]);
  const container = () => editor.getContainer().getBoundingClientRect();

  const local = (event: ReactPointerEvent) => {
    const box = container();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  return (
    <>
      {(handle || drag) && (
        <Tip label="Drag onto a node to wire it" side="right">
          {/* oxlint-disable-next-line react/forbid-elements -- the wire handle is a dot dragged across the canvas, not a kit button */}
          <button
            type="button"
            aria-label="Wire handle"
            data-testid="wire-handle"
            data-wire-from={drag?.from ?? handle?.id}
            className="pointer-events-auto absolute top-0 left-0 z-[400] size-3.5 -translate-1/2 cursor-crosshair rounded-full border-2 border-background bg-ring shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ transform: `translate(${drag?.start.x ?? handle!.x}px, ${drag?.start.y ?? handle!.y}px) translate(-50%, -50%)` }}
            onPointerEnter={() => handle && setHeld(handle.id)}
            onPointerLeave={() => !drag && setHeld(undefined)}
            onPointerDown={(event) => {
              if (event.button !== 0 || !handle) return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              const start = { x: handle.x, y: handle.y };
              setDrag({ from: handle.id, start, at: local(event) });
            }}
            onPointerMove={(event) => drag && setDrag({ ...drag, at: local(event) })}
            onPointerUp={(event) => {
              const current = drag;
              setDrag(undefined);
              setHeld(undefined);
              if (!current) return;
              if (Math.hypot(current.at.x - current.start.x, current.at.y - current.start.y) < 8) return;
              const point = editor.screenToPage({ x: event.clientX, y: event.clientY });
              const target = editor.getShapeAtPoint(point, { hitInside: true, margin: 4, renderingOnly: true, filter: (shape) => shape.type !== "wire" && shape.id !== current.from });
              connectWire(editor, current.from, target?.id);
            }}
          />
        </Tip>
      )}
      {drag && (
        <>
          <svg className="pointer-events-none absolute inset-0 z-[400] size-full overflow-visible" aria-hidden data-testid="wire-preview">
            <path
              d={`M ${drag.start.x} ${drag.start.y} C ${drag.start.x + 80} ${drag.start.y}, ${drag.at.x - 80} ${drag.at.y}, ${drag.at.x} ${drag.at.y}`}
              fill="none"
              className="stroke-ring"
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          </svg>
        </>
      )}
    </>
  );
};
