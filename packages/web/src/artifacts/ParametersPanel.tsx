import type { ArtifactShapeProps } from "@unframed/contracts";
import { artifactTitle, isArtifactKind, keepPanelOnScreen, panelSize, type ArtifactKind, type PanelPrefs, type PanelRoom } from "@unframed/domain";
import { PanelRight, PictureInPicture2, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useEditor, useValue, type Editor, type TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { TOP_BAR_HEIGHT } from "~/components/ui/top-bar";
import { cn } from "~/lib/utils";
import { useWheelToCanvas } from "../canvas/wheelToCanvas.ts";
import { Tip } from "../chrome/ui.tsx";
import { useEngine } from "../context.ts";
import { canvasRoom, placeBeside } from "../generate/floating.ts";
import { usePanelPrefs } from "./panelPrefs.ts";
import { ParametersContent } from "./editor/Parameters.tsx";
import { artifactsOf } from "./state.ts";

const stop = (event: { stopPropagation(): void }) => event.stopPropagation();

const RESIZE_STEP = 16;

const FLOAT_CLASS =
  "pointer-events-auto invisible absolute top-0 left-0 z-[500] box-border flex w-80 flex-col overflow-hidden rounded-xl border bg-card font-sans text-foreground shadow-lg/5 opacity-100 [scale:1] [transition:opacity_150ms_ease-out,scale_150ms_ease-out] starting:opacity-0 starting:[scale:0.97] motion-reduce:[transition:opacity_150ms_ease-out] motion-reduce:starting:[scale:1]";

const DOCK_CLASS =
  "pointer-events-auto absolute top-9 right-0 bottom-0 z-[500] box-border flex w-80 flex-col border-l bg-card font-sans text-foreground [transform:none] opacity-100 [transition:transform_260ms_var(--ease-drawer),opacity_200ms_ease-out] starting:[transform:translateX(100%)] starting:opacity-0 motion-reduce:[transition:opacity_160ms_ease-out] motion-reduce:starting:[transform:none]";

const roomOf = (editor: Editor): PanelRoom => {
  const canvas = canvasRoom(editor);
  return { x: 0, y: TOP_BAR_HEIGHT, w: canvas.w, h: Math.max(0, canvas.h - TOP_BAR_HEIGHT) };
};

interface Floating {
  x: number;
  y: number;
  w: number;
  h: number | undefined;
}

export const ParametersPanel = ({ shapeId }: { readonly shapeId: TLShapeId }) => {
  const editor = useEditor();
  const engine = useEngine();
  const [prefs, savePrefs] = usePanelPrefs(engine);
  const root = useRef<HTMLElement>(null);
  const floating = useRef<Floating | undefined>(undefined);
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
  const prefsNow = useRef(prefs);
  prefsNow.current = prefs;
  const mode = prefs?.mode;
  useWheelToCanvas(editor, root);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.type === "keydown" && event.target instanceof Element && event.target.closest("[data-resize-handle]") !== null) resizeKeyNow.current(event);
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
  }, [mode]);

  const paint = () => {
    const element = root.current;
    const box = floating.current;
    if (!element || !box) return;
    const room = roomOf(editor);
    element.style.transform = `translate(${box.x}px, ${box.y}px)`;
    element.style.width = `${box.w}px`;
    element.style.height = box.h === undefined ? "" : `${box.h}px`;
    element.style.maxHeight = `${Math.max(120, room.y + room.h - 8 - box.y)}px`;
    element.style.visibility = "visible";
  };

  const settle = (box: Floating): Floating => {
    const room = roomOf(editor);
    const size = panelSize({ w: box.w, h: box.h }, room);
    const shown = { w: size.w, h: size.h ?? Math.min(root.current?.offsetHeight ?? 0, room.h - 16) };
    return { ...keepPanelOnScreen(box, shown, room), w: size.w, h: size.h };
  };

  const remember = (box: Floating) => {
    const place: PanelPrefs = { mode: "float", x: box.x, y: box.y, w: box.w };
    savePrefs(box.h === undefined ? place : { ...place, h: box.h });
  };

  useLayoutEffect(() => {
    if (mode !== "float") return;
    const element = root.current;
    const saved = prefsNow.current;
    if (!element || !saved) return;
    const room = roomOf(editor);
    const size = panelSize({ w: saved.w, h: saved.h }, room);
    element.style.width = `${size.w}px`;
    element.style.height = size.h === undefined ? "" : `${size.h}px`;
    if (saved.x === undefined || saved.y === undefined) {
      const bounds = editor.getShapePageBounds(shapeId);
      const topLeft = bounds ? editor.pageToViewport({ x: bounds.minX, y: bounds.minY }) : { x: 0, y: 0 };
      const bottomRight = bounds ? editor.pageToViewport({ x: bounds.maxX, y: bounds.maxY }) : { x: 0, y: 0 };
      const beside = placeBeside({ x: topLeft.x, y: topLeft.y, w: bottomRight.x - topLeft.x, h: bottomRight.y - topLeft.y }, { w: size.w, h: element.offsetHeight }, canvasRoom(editor));
      floating.current = settle({ x: beside.left, y: beside.top, w: size.w, h: size.h });
      remember(floating.current);
    } else {
      floating.current = settle({ x: saved.x, y: saved.y, w: size.w, h: size.h });
    }
    paint();
    const onResize = () => {
      if (!floating.current) return;
      floating.current = settle(floating.current);
      paint();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [editor, shapeId, mode]);

  const track = (event: ReactPointerEvent<HTMLElement>, move: (start: Floating, dx: number, dy: number) => Floating) => {
    const box = floating.current;
    const element = root.current;
    if (event.button !== 0 || !box || !element) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const start = { ...box, h: box.h ?? element.offsetHeight };
    const from = { x: event.clientX, y: event.clientY };
    const onMove = (next: PointerEvent) => {
      floating.current = settle(move(start, next.clientX - from.x, next.clientY - from.y));
      paint();
    };
    const onEnd = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onEnd);
      target.removeEventListener("pointercancel", onEnd);
      target.removeEventListener("lostpointercapture", onEnd);
      if (floating.current) remember(floating.current);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onEnd);
    target.addEventListener("pointercancel", onEnd);
    target.addEventListener("lostpointercapture", onEnd);
  };

  const onHeaderDown = (event: ReactPointerEvent<HTMLElement>) => {
    stop(event);
    if (mode !== "float" || (event.target as Element).closest("button") !== null) return;
    const keep = floating.current?.h;
    track(event, (start, dx, dy) => ({ ...start, x: start.x + dx, y: start.y + dy, h: keep }));
  };

  const onResizeDown = (event: ReactPointerEvent<HTMLElement>) => {
    stop(event);
    track(event, (start, dx, dy) => ({ ...start, w: start.w + dx, h: (start.h ?? 0) + dy }));
  };

  const onResizeKey = (event: KeyboardEvent) => {
    const box = floating.current;
    const element = root.current;
    if (!box || !element) return;
    const step = { ArrowLeft: [-RESIZE_STEP, 0], ArrowRight: [RESIZE_STEP, 0], ArrowUp: [0, -RESIZE_STEP], ArrowDown: [0, RESIZE_STEP] }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    floating.current = settle({ ...box, w: box.w + step[0]!, h: (box.h ?? element.offsetHeight) + step[1]! });
    paint();
    remember(floating.current);
  };
  const resizeKeyNow = useRef(onResizeKey);
  resizeKeyNow.current = onResizeKey;

  const switchMode = () => {
    const current = prefsNow.current ?? { mode: "float" as const };
    savePrefs({ ...current, mode: current.mode === "dock" ? "float" : "dock" });
  };

  if (!facts || !prefs) return null;
  const title = facts.title === "" ? shapeId.replace(/^shape:/, "") : facts.title;
  const post = (values: unknown) => artifactsOf(editor).posts.get(shapeId)?.(values);
  const docked = prefs.mode === "dock";

  return (
    <section
      key={prefs.mode}
      ref={root}
      aria-label={`Parameters for ${title}`}
      data-testid="artifact-parameters-panel"
      data-mode={prefs.mode}
      data-slot={docked ? "parameters-dock" : undefined}
      className={docked ? DOCK_CLASS : FLOAT_CLASS}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      <header
        data-drag-handle={docked ? undefined : ""}
        className={cn("flex h-12 flex-none items-center gap-1 border-b ps-2.5 pe-2", !docked && "cursor-grab touch-none select-none active:cursor-grabbing")}
        onPointerDown={onHeaderDown}
      >
        <SlidersHorizontal aria-hidden className="me-1 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">Parameters</span>
        <Tip label={docked ? "Float" : "Dock to the right"}>
          <Button variant="ghost" size="icon-sm" aria-label={docked ? "Float parameters" : "Dock parameters to the right"} onClick={switchMode}>
            {docked ? <PictureInPicture2 aria-hidden /> : <PanelRight aria-hidden />}
          </Button>
        </Tip>
        <Tip label="Close (Esc)">
          <Button variant="ghost" size="icon-sm" aria-label="Close parameters" onClick={close}>
            <X aria-hidden />
          </Button>
        </Tip>
      </header>
      <div className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden", announcement === undefined && "pb-2.5", docked && "pb-12")} data-scrolls="true">
        <ParametersContent shapeId={shapeId} kind={facts.kind} title={title} announcement={announcement} saved={facts.dials} post={post} place="canvas" />
      </div>
      {!docked && (
        <div
          role="separator"
          aria-label="Resize parameters"
          aria-orientation="vertical"
          tabIndex={0}
          data-resize-handle=""
          className="absolute end-0 bottom-0 size-4 cursor-nwse-resize touch-none rounded-br-xl outline-none after:absolute after:end-1 after:bottom-1 after:size-2 after:border-e-2 after:border-b-2 after:border-muted-foreground/40 after:rounded-br-[3px] hover:after:border-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onPointerDown={onResizeDown}
        />
      )}
    </section>
  );
};
