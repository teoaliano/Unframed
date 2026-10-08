/**
 * The canvas's Parameters panel (spec 09): one artifact's dials beside it, driving its live
 * frame on the canvas. Loaded the first time a panel opens, with DialKit.
 */
import type { ArtifactShapeProps } from "@unframed/contracts";
import { artifactTitle, isArtifactKind, type ArtifactKind } from "@unframed/domain";
import { SlidersHorizontal, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { atom, react, useEditor, useValue, type TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { useWheelToCanvas } from "../canvas/wheelToCanvas.ts";
import { Tip } from "../chrome/ui.tsx";
import { canvasRoom, placeBeside } from "../generate/floating.ts";
import { DialControls } from "./DialControls.tsx";
import { AddParameter } from "./editor/Parameters.tsx";
import { artifactsOf } from "./state.ts";

const stop = (event: { stopPropagation(): void }) => event.stopPropagation();

export const ParametersPanel = ({ shapeId }: { readonly shapeId: TLShapeId }) => {
  const editor = useEditor();
  const root = useRef<HTMLElement>(null);
  const [size] = useState(() => atom("parameters panel size", { w: 0, h: 0 }));
  const facts = useValue(
    "tuned artifact",
    () => {
      const shape = editor.getShape(shapeId);
      if (!shape || !isArtifactKind(shape.type)) return undefined;
      const props = shape.props as ArtifactShapeProps;
      return { kind: shape.type as ArtifactKind, title: artifactTitle(props), dials: props.dials };
    },
    [editor, shapeId],
  );
  const announcement = useValue("tuned announcement", () => artifactsOf(editor).heard.get().get(shapeId), [editor, shapeId]);
  const close = () => artifactsOf(editor).tuning.set(undefined);
  const closeNow = useRef(close);
  closeNow.current = close;
  useWheelToCanvas(editor, root);

  // Keys typed in the panel are the panel's: tldraw's container and body listeners would nudge or delete the page.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.type !== "keydown" || event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      closeNow.current();
    };
    element.addEventListener("keydown", onKey);
    element.addEventListener("keyup", onKey);
    return () => {
      element.removeEventListener("keydown", onKey);
      element.removeEventListener("keyup", onKey);
    };
  }, []);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(() => size.set({ w: element.offsetWidth, h: element.offsetHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [size]);

  // Following the page as the canvas pans writes two style values and renders nothing: DialKit stays off the pan path.
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    return react("parameters panel place", () => {
      const bounds = editor.getShapePageBounds(shapeId);
      const measured = size.get();
      if (!bounds || measured.w === 0) return;
      const topLeft = editor.pageToViewport({ x: bounds.minX, y: bounds.minY });
      const bottomRight = editor.pageToViewport({ x: bounds.maxX, y: bounds.maxY });
      const canvas = canvasRoom(editor);
      const place = placeBeside({ x: topLeft.x, y: topLeft.y, w: bottomRight.x - topLeft.x, h: bottomRight.y - topLeft.y }, measured, canvas);
      element.style.transform = `translate(${Math.round(place.left)}px, ${Math.round(place.top)}px)`;
      element.style.maxHeight = `${Math.max(120, canvas.h - 16)}px`;
      element.style.visibility = "visible";
    });
  }, [editor, shapeId, size]);

  if (!facts) return null;
  const title = facts.title === "" ? shapeId.replace(/^shape:/, "") : facts.title;
  const post = (values: unknown) => artifactsOf(editor).posts.get(shapeId)?.(values);

  return (
    <section
      ref={root}
      aria-label={`Parameters for ${title}`}
      data-testid="artifact-parameters-panel"
      className="pointer-events-auto invisible absolute top-0 left-0 z-[500] box-border flex w-80 flex-col overflow-hidden rounded-xl border bg-card font-sans text-foreground shadow-lg/5"
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      <header className="flex h-12 flex-none items-center gap-2 border-b px-2.5">
        <SlidersHorizontal aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        {/* The artifact is beside the panel and DialKit names its parameters: no title here. */}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">Parameters</span>
        <Tip label="Close (Esc)">
          <Button variant="ghost" size="icon-sm" aria-label="Close parameters" onClick={close}>
            <X aria-hidden />
          </Button>
        </Tip>
      </header>
      <div className="min-h-0 flex-1 overflow-auto" data-scrolls="true">
        {announcement === undefined ? (
          <p className="mx-2.5 my-4 text-sm text-muted-foreground">No parameters yet.</p>
        ) : (
          <DialControls shapeId={shapeId} announcement={announcement} saved={facts.dials} post={post} />
        )}
      </div>
      {/* With nothing to tune, the panel asks the agent for parameters rather than end there. */}
      {announcement === undefined && <AddParameter shapeId={shapeId} kind={facts.kind} title={title} hasParameters={false} openRail />}
    </section>
  );
};
