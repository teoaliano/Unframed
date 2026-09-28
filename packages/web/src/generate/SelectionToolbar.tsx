import { UnframedError, type ResultRecipe } from "@unframed/contracts";
import { composeSelection, resultLine, toolbarState, type ToolbarState } from "@unframed/domain";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useEditor, useValue, type Editor, type TLShapeId } from "tldraw";
import { Tip } from "../chrome/ui.tsx";
import { useSlots } from "../chrome/slots.ts";
import { useCanvasProject, useEngine } from "../context.ts";
import { showError } from "../toasts.tsx";
import { loadCatalogue } from "./catalogue.ts";
import { Composer } from "./composer/Composer.tsx";
import { assetOf, canvasShapes, resultOf, resultShapes, toolbarShape } from "./facts.ts";
import { placeFloating, type ScreenBox } from "./floating.ts";
import { repeatResult, varyBlocked, varyCapMessage } from "./results.ts";
import { closeComposer, composerState, leaveRecipeMode, openComposer } from "./state.ts";

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

/** The gestures the bar hides for: dragging a shape or its handles, dragging the canvas, box selection. */
const GESTURES = [
  "select.translating",
  "select.resizing",
  "select.rotating",
  "select.dragging_handle",
  "select.brushing",
  "select.scribble_brushing",
  "select.crop.translating_crop",
  "select.crop.cropping",
  "hand.dragging",
] as const;

const hiddenByGesture = (editor: Editor): boolean =>
  editor.isInAny(...GESTURES) || (editor.inputs.getIsPanning() && editor.inputs.getIsPointing());

/** The selection's bounds on screen, relative to the canvas. */
const selectionOnScreen = (editor: Editor): ScreenBox | undefined => {
  const bounds = editor.getSelectionPageBounds();
  if (!bounds) return undefined;
  const topLeft = editor.pageToViewport({ x: bounds.minX, y: bounds.minY });
  const bottomRight = editor.pageToViewport({ x: bounds.maxX, y: bounds.maxY });
  return { x: topLeft.x, y: topLeft.y, w: bottomRight.x - topLeft.x, h: bottomRight.y - topLeft.y };
};

const buttonClass = (kind: "primary" | "plain" | "quiet") => `unframed-bar-button unframed-bar-button--${kind}`;

/** A wheel over the bar or the composer moves the canvas, unless it is over something that scrolls itself. */
const useWheelToCanvas = (editor: Editor, root: React.RefObject<HTMLDivElement | null>) => {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      for (let node = event.target as HTMLElement | null; node && node !== element; node = node.parentElement) {
        if (node.dataset.scrolls === "true" && node.scrollHeight > node.clientHeight) return;
      }
      event.preventDefault();
      event.stopPropagation();
      const canvas = editor.getContainer().querySelector(".tl-canvas");
      canvas?.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: event.clientX,
          clientY: event.clientY,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaZ: event.deltaZ,
          deltaMode: event.deltaMode,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
        }),
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [editor, root]);
};

/**
 * The floating element that is the bar and grows into the composer on the same centre and
 * bottom edge (top edge when flipped below the selection). It measures its content and
 * animates to that size and place.
 */
const Floating = ({ target, hidden, expanded, children }: { target: ScreenBox | undefined; hidden: boolean; expanded: boolean; children: ReactNode }) => {
  const editor = useEditor();
  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>();
  // Only the morph between bar and composer animates; following the selection never lags.
  const [morphing, setMorphing] = useState(false);
  const wasExpanded = useRef(expanded);
  useWheelToCanvas(editor, root);
  useLayoutEffect(() => {
    if (wasExpanded.current === expanded) return;
    wasExpanded.current = expanded;
    setMorphing(true);
    const timer = setTimeout(() => setMorphing(false), 260);
    return () => clearTimeout(timer);
  }, [expanded]);

  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const measure = () => setSize((previous) => (previous?.w === element.offsetWidth && previous.h === element.offsetHeight ? previous : { w: element.offsetWidth, h: element.offsetHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const canvas = useValue(
    "canvas size",
    () => {
      const bounds = editor.getViewportScreenBounds();
      return { w: bounds.w, h: bounds.h };
    },
    [editor],
  );
  const place = size && target ? placeFloating(target, size, canvas) : undefined;

  return (
    <div
      ref={root}
      className="unframed-floating"
      data-testid="selection-toolbar"
      data-side={place?.side}
      data-expanded={expanded ? "true" : undefined}
      data-morphing={morphing ? "true" : undefined}
      style={{
        left: place?.left ?? 0,
        top: place?.top ?? 0,
        width: size?.w,
        height: size?.h,
        visibility: place && !hidden ? "visible" : "hidden",
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div ref={content} className="unframed-floating__content" data-side={place?.side}>
        {children}
      </div>
    </div>
  );
};

/** The recipe of the one selected result, read when it is selected, for Vary's cap. */
const useSelectedRecipe = (shapeId: string | undefined, sidecar: string | null | undefined) => {
  const engine = useEngine();
  const project = useCanvasProject();
  const [recipe, setRecipe] = useState<{ shapeId: string; recipe: ResultRecipe }>();
  useEffect(() => {
    if (shapeId === undefined || !sidecar) return;
    let live = true;
    void loadCatalogue(engine, "image").catch(() => undefined);
    engine.call("recipe.read", { project, shapeId }).then(
      (answer) => {
        if (live) setRecipe({ shapeId, recipe: answer });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [engine, project, shapeId, sidecar]);
  return recipe !== undefined && recipe.shapeId === shapeId ? recipe.recipe : undefined;
};

const AgentButton = ({ onOpen }: { onOpen: () => void }) => (
  <>
    <span className="unframed-bar-separator" aria-hidden />
    <button type="button" className={buttonClass("plain")} onClick={onOpen}>
      Agent
    </button>
  </>
);

const ResultBar = ({ shapeId, agent }: { shapeId: TLShapeId; agent: ReactNode }) => {
  const editor = useEditor();
  const engine = useEngine();
  const project = useCanvasProject();
  const [busy, setBusy] = useState(false);
  const facts = useValue(
    "result facts",
    () => {
      const shape = editor.getShape(shapeId);
      const result = shape ? resultOf(shape) : undefined;
      if (!shape || !result) return undefined;
      const asset = assetOf(editor, shape)?.props as { w?: number; h?: number } | undefined;
      return {
        line: resultLine({ model: result.model, width: asset?.w, height: asset?.h, cost: result.cost }),
        sidecar: result.sidecar,
        text: shape.type === "text",
      };
    },
    [editor, shapeId],
  );
  const recipe = useSelectedRecipe(shapeId, facts?.sidecar);
  const cap = recipe ? varyBlocked(recipe) : undefined;

  const act = async (action: "regenerate" | "vary") => {
    if (busy) return;
    setBusy(true);
    try {
      await repeatResult(editor, engine, project, shapeId, action, recipe);
    } catch (error) {
      showError(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  const openRecipe = async () => {
    try {
      const recorded = recipe ?? (await engine.call("recipe.read", { project, shapeId }));
      openComposer(editor, "generate", { shapeId, recipe: recorded, selection: editor.getSelectedShapeIds() });
    } catch (error) {
      showError(messageOf(error));
    }
  };

  return (
    <div className="unframed-bar unframed-bar--result">
      <div className="unframed-bar__row">
        <button type="button" className={buttonClass("primary")} disabled={busy} onClick={() => void act("regenerate")}>
          Regenerate
        </button>
        {!facts?.text &&
          (cap !== undefined ? (
            <Tip label={varyCapMessage(cap)} side="top">
              <span className="inline-flex" tabIndex={0}>
                <button type="button" className={buttonClass("plain")} disabled>
                  Vary
                </button>
              </span>
            </Tip>
          ) : (
            <button type="button" className={buttonClass("plain")} disabled={busy} onClick={() => void act("vary")}>
              Vary
            </button>
          ))}
        <button type="button" className={buttonClass("quiet")} onClick={() => void openRecipe()}>
          Recipe
        </button>
        {agent}
      </div>
      {facts && (
        <div className="unframed-bar__line" data-testid="result-line">
          {facts.line}
        </div>
      )}
    </div>
  );
};

const Bar = ({ state, onGenerate, agent }: { state: Exclude<ToolbarState, { kind: "none" }>; onGenerate: () => void; agent: ReactNode }) => {
  const editor = useEditor();
  const { openArtifact } = useSlots();
  switch (state.kind) {
    case "result":
      return <ResultBar shapeId={state.shapeId as TLShapeId} agent={agent} />;
    case "generating":
      return (
        <div className="unframed-bar">
          <span className="unframed-bar__hint">Generating…</span>
          {agent}
        </div>
      );
    case "open":
      return (
        <div className="unframed-bar">
          <button type="button" className={buttonClass("primary")} onClick={() => openArtifact?.(editor, state.shapeId as TLShapeId)}>
            Open
          </button>
          {agent}
        </div>
      );
    case "generate":
      return (
        <div className="unframed-bar">
          <button type="button" className={buttonClass("primary")} onClick={onGenerate}>
            Generate
          </button>
          <span className="unframed-bar__hint" data-testid="selection-hint">
            {state.hint}
          </span>
          {agent}
        </div>
      );
    case "agent":
      return agent === null ? null : <div className="unframed-bar">{agent}</div>;
  }
};

/**
 * The selection toolbar: over every selection, its buttons decided from the selection, and
 * the composer it grows into. It hides while a gesture is under way.
 */
export const SelectionToolbar = () => {
  const editor = useEditor();
  const project = useCanvasProject();
  const { agentTray } = useSlots();
  const composer = useValue("composer", () => composerState(editor).get(), [editor]);
  const hidden = useValue("toolbar hidden", () => hiddenByGesture(editor), [editor]);
  const selectionKey = useValue("selection", () => editor.getSelectedShapeIds().join(" "), [editor]);
  const expanded = composer.mode !== "bar";

  const state = useValue(
    "toolbar state",
    (): ToolbarState | undefined => {
      if (hiddenByGesture(editor) && composerState(editor).get().mode === "bar") return undefined;
      const selected = editor.getSelectedShapes();
      if (selected.length === 0) return { kind: "none" };
      const usable = composeSelection({ shapes: canvasShapes(editor), selected: editor.getSelectedShapeIds(), instruction: "", medium: "image" }).usable;
      return toolbarState({ selected: selected.map((shape) => toolbarShape(editor, shape)), usable, results: resultShapes(editor) });
    },
    [editor],
  );
  const target = useValue("selection on screen", () => (hiddenByGesture(editor) ? undefined : selectionOnScreen(editor)), [editor]);
  const lastTarget = useRef<ScreenBox>(undefined);
  if (target) lastTarget.current = target;

  // Clicking empty canvas closes the composer; a changed selection leaves recipe mode.
  useEffect(() => {
    const { mode, recipe } = composerState(editor).get();
    if (selectionKey === "" && mode !== "bar") closeComposer(editor);
    else if (recipe && recipe.selection.join(" ") !== selectionKey) leaveRecipeMode(editor);
  }, [editor, selectionKey]);

  const collapse = useCallback(() => closeComposer(editor), [editor]);
  const agent = agentTray ? <AgentButton onOpen={() => openComposer(editor, "agent")} /> : null;

  if (selectionKey === "") return null;
  if (!expanded && (state === undefined || state.kind === "none" || (state.kind === "agent" && agent === null))) return null;

  return (
    <Floating target={target ?? lastTarget.current} hidden={hidden} expanded={expanded}>
      {expanded ? (
        <Composer mode={composer.mode === "agent" ? "agent" : "generate"} project={project} recipe={composer.recipe} onCollapse={collapse} />
      ) : state && state.kind !== "none" ? (
        <Bar state={state} onGenerate={() => openComposer(editor, "generate")} agent={agent} />
      ) : null}
    </Floating>
  );
};
