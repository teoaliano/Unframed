import type { ArtifactShapeProps } from "@unframed/contracts";
import { artifactTitle, isArtifactKind, type ArtifactKind, type PanelPrefs } from "@unframed/domain";
import { GripVertical, PanelRight, PictureInPicture2, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useEditor, useValue, type TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { Sheet, SheetPopup } from "~/components/ui/sheet";
import { TOP_BAR_HEIGHT } from "~/components/ui/top-bar";
import { cn } from "~/lib/utils";
import { useWheelToCanvasOn } from "../canvas/wheelToCanvas.ts";
import { useNarrowWindow } from "../chrome/narrowWindow.ts";
import { Tip } from "../chrome/ui.tsx";
import { useEngine } from "../context.ts";
import { ParametersContent } from "./editor/Parameters.tsx";
import { useFloatingPlacement } from "./panelPlacement.ts";
import { usePanelPrefs } from "./panelPrefs.ts";
import { artifactsOf } from "./state.ts";

const stop = (event: { stopPropagation(): void }) => event.stopPropagation();

type Shown = "float" | "dock" | "sheet";

const FLOAT_CLASS =
  "pointer-events-auto invisible absolute top-0 left-0 z-[500] box-border flex w-80 flex-col overflow-hidden rounded-xl border bg-card font-sans text-foreground shadow-lg/5 opacity-100 [scale:1] [transition:opacity_150ms_ease-out,scale_150ms_ease-out] starting:opacity-0 starting:[scale:0.97] motion-reduce:[transition:opacity_150ms_ease-out] motion-reduce:starting:[scale:1]";

const DOCK_CLASS =
  "pointer-events-auto absolute right-0 bottom-0 z-[500] box-border flex w-(--parameters-dock-width) flex-col border-l bg-background font-sans text-foreground [transform:none] opacity-100 [transition:transform_260ms_var(--ease-drawer),opacity_200ms_ease-out] starting:[transform:translateX(100%)] starting:opacity-0 motion-reduce:[transition:opacity_160ms_ease-out] motion-reduce:starting:[transform:none]";

const SHEET_CLASS = "relative box-border flex size-full min-h-0 flex-col bg-background font-sans text-foreground";

export const ParametersPanel = ({ shapeId }: { readonly shapeId: TLShapeId }) => {
  const editor = useEditor();
  const engine = useEngine();
  const narrow = useNarrowWindow();
  const [prefs, savePrefs] = usePanelPrefs(engine);
  const [element, setElement] = useState<HTMLElement | null>(null);
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
  const shown: Shown | undefined = prefs === undefined ? undefined : prefs.mode === "float" ? "float" : narrow ? "sheet" : "dock";
  const placement = useFloatingPlacement({ editor, element, shapeId, floating: shown === "float", prefs, save: savePrefs });
  const live = useRef({ close, placement });
  live.current = { close, placement };
  useWheelToCanvasOn(editor, shown === "sheet" ? null : element);

  useEffect(() => {
    if (shown === undefined) return;
    const container = editor.getContainer();
    container.dataset.parametersPanel = shown;
    return () => {
      delete container.dataset.parametersPanel;
    };
  }, [editor, shown]);

  useEffect(() => {
    if (!element) return;
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.type !== "keydown" || event.defaultPrevented) return;
      const handle = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-panel-handle]")?.dataset.panelHandle : undefined;
      if ((handle === "move" || handle === "resize") && live.current.placement.nudge(event.key, handle)) {
        event.preventDefault();
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      live.current.close();
    };
    element.addEventListener("keydown", onKey);
    element.addEventListener("keyup", onKey);
    return () => {
      element.removeEventListener("keydown", onKey);
      element.removeEventListener("keyup", onKey);
    };
  }, [element]);

  if (!facts || !prefs || shown === undefined) return null;
  const title = facts.title === "" ? shapeId.replace(/^shape:/, "") : facts.title;
  const post = (values: unknown) => artifactsOf(editor).posts.get(shapeId)?.(values);
  const floating = shown === "float";
  const switchMode = () => savePrefs({ ...prefs, mode: prefs.mode === "dock" ? "float" : "dock" } satisfies PanelPrefs);
  const onHeaderDown = (event: ReactPointerEvent<HTMLElement>) => {
    stop(event);
    if (floating && (event.target as Element).closest("button") === null) placement.startMove(event);
  };

  const panel = (
    <section
      key={shown}
      ref={setElement}
      aria-label={`Parameters for ${title}`}
      data-testid="artifact-parameters-panel"
      data-mode={prefs.mode}
      data-shown={shown}
      data-slot={shown === "dock" ? "parameters-dock" : undefined}
      className={shown === "float" ? FLOAT_CLASS : shown === "dock" ? DOCK_CLASS : SHEET_CLASS}
      style={shown === "dock" ? { top: TOP_BAR_HEIGHT } : undefined}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      <header
        className={cn("flex h-12 flex-none items-center gap-1 border-b ps-2.5 pe-2", floating && "cursor-grab touch-none select-none active:cursor-grabbing")}
        onPointerDown={onHeaderDown}
      >
        {floating && (
          <Tip label="Move (drag, or arrow keys)">
            <span
              role="button"
              tabIndex={0}
              aria-label="Move parameters"
              aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
              data-panel-handle="move"
              className="-ms-1 flex h-6 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <GripVertical aria-hidden className="size-3.5" />
            </span>
          </Tip>
        )}
        <SlidersHorizontal aria-hidden className="me-1 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">Parameters</span>
        <Tip label={floating ? "Dock to the right" : "Float"}>
          <Button variant="ghost" size="icon-sm" aria-label={floating ? "Dock parameters to the right" : "Float parameters"} onClick={switchMode}>
            {floating ? <PanelRight aria-hidden /> : <PictureInPicture2 aria-hidden />}
          </Button>
        </Tip>
        <Tip label="Close (Esc)">
          <Button variant="ghost" size="icon-sm" aria-label="Close parameters" onClick={close}>
            <X aria-hidden />
          </Button>
        </Tip>
      </header>
      <div className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden", announcement === undefined && "pb-2.5", shown === "dock" && "pb-16")} data-scrolls="true">
        <ParametersContent shapeId={shapeId} kind={facts.kind} title={title} announcement={announcement} saved={facts.dials} post={post} place="canvas" />
      </div>
      {floating && (
        <div
          role="separator"
          aria-label="Resize parameters"
          aria-orientation="vertical"
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
          tabIndex={0}
          data-panel-handle="resize"
          className="absolute end-0 bottom-0 size-4 cursor-nwse-resize touch-none rounded-br-xl outline-none after:absolute after:end-1 after:bottom-1 after:size-2 after:rounded-br-[3px] after:border-e-2 after:border-b-2 after:border-muted-foreground/40 hover:after:border-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onPointerDown={(event) => {
            stop(event);
            placement.startResize(event);
          }}
        />
      )}
    </section>
  );

  if (shown !== "sheet") return panel;
  return (
    <Sheet open onOpenChange={(open) => !open && close()}>
      <SheetPopup side="right" showCloseButton={false} className="mb-12 w-[min(88vw,24rem)]">
        {panel}
      </SheetPopup>
    </Sheet>
  );
};
