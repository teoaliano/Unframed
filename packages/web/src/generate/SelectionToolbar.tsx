import { resultMetaOf, UnframedError, type ResultRecipe } from "@unframed/contracts";
import { composeSelection, resultLine, toolbarState, type ToolbarState } from "@unframed/domain";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useEditor, useValue, type Editor, type TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { cn } from "~/lib/utils";
import { groupRecipeOf } from "../canvas/groupRecipes.ts";
import { Tip } from "../chrome/ui.tsx";
import { useSlots } from "../chrome/slots.ts";
import { useCanvasProject, useEngine, useSettings } from "../context.ts";
import { showError } from "../toasts.tsx";
import { loadCatalogue, useKnownCatalogue, usePricing } from "./catalogue.ts";
import { Composer } from "./composer/Composer.tsx";
import { assetOf, canvasShapes, resultShapes, toolbarShape } from "./facts.ts";
import { placeFloating, type ScreenBox } from "./floating.ts";
import { mediumDefinition, type RunSource } from "./mediumRegistry.ts";
import { openOnRecipe, recipeProps, recipeRunProgress, runGroupRecipe } from "./recipeRuns.ts";
import { repeatResult, varyBlocked, varyCapMessage } from "./results.ts";
import { closeComposer, composerState, leaveRecipeMode, openComposer } from "./state.ts";
import { composerGlassClass } from "../chrome/composerSurface.ts";

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
      className={cn(
        "pointer-events-auto absolute z-[500] box-border overflow-hidden border font-sans text-foreground data-[morphing=true]:transition-[left,top,width,height,border-radius,background-color,box-shadow] data-[morphing=true]:duration-200 data-[morphing=true]:ease-out motion-reduce:data-[morphing=true]:transition-none",
        // The bar is a glass card; the composer is t3code's composer shell.
        expanded
          ? `${composerGlassClass} rounded-3xl shadow-composer dark:shadow-none`
          : "rounded-xl shadow-lg/5 surface-glass",
      )}
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
      {/* Bar and composer are different children, so under reduced motion each fades in as it replaces the other. */}
      <div
        ref={content}
        className="absolute left-0 top-0 data-[side=above]:top-auto data-[side=above]:bottom-0 motion-reduce:*:transition-opacity motion-reduce:*:duration-[120ms] motion-reduce:*:ease-linear motion-reduce:*:starting:opacity-0"
        data-side={place?.side}
      >
        {children}
      </div>
    </div>
  );
};

/** The bar's row of buttons and hint; `barClass` pads it inside the floating element. */
const rowClass = "flex items-center gap-1.5";
const barClass = `${rowClass} whitespace-nowrap p-1`;
const hintClass = "px-1 text-xs text-muted-foreground";

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

const AgentButton = ({ onOpen }: { onOpen: () => void }) => {
  const { agentToolbarButton: Registered } = useSlots();
  return (
    <>
      <Separator orientation="vertical" className="mx-0.5 my-1" />
      {Registered ? (
        <Registered onOpen={onOpen} />
      ) : (
        <Button size="sm" onClick={onOpen}>
          Agent
        </Button>
      )}
    </>
  );
};

const ResultBar = ({ shapeId, agent }: { shapeId: TLShapeId; agent: ReactNode }) => {
  const editor = useEditor();
  const engine = useEngine();
  const project = useCanvasProject();
  const [busy, setBusy] = useState(false);
  const facts = useValue(
    "result facts",
    () => {
      const shape = editor.getShape(shapeId);
      const result = shape ? resultMetaOf(shape) : undefined;
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
    <div className="flex flex-col gap-0.5 whitespace-nowrap p-1">
      <div className={rowClass}>
        <Button size="sm" disabled={busy} onClick={() => void act("regenerate")}>
          Regenerate
        </Button>
        {!facts?.text &&
          (cap !== undefined ? (
            <Tip label={varyCapMessage(cap)} side="top">
              <span className="inline-flex" tabIndex={0}>
                <Button variant="outline" size="sm" disabled>
                  Vary
                </Button>
              </span>
            </Tip>
          ) : (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void act("vary")}>
              Vary
            </Button>
          ))}
        <Button variant="ghost" size="sm" onClick={() => void openRecipe()}>
          Recipe
        </Button>
        {agent}
      </div>
      {facts && (
        <div className="px-1.5 py-0.5 text-xs text-muted-foreground tabular-nums" data-testid="result-line">
          {facts.line}
        </div>
      )}
    </div>
  );
};

/**
 * The bar of a selection holding one recipe group: Generate runs the recipe at once (a
 * Free recipe stops at the final prompt), the hint names the group and the estimate, and
 * Recipe opens the composer on it.
 */
const RecipeBar = ({ state, agent }: { state: Extract<ToolbarState, { kind: "recipe" }>; agent: ReactNode }) => {
  const editor = useEditor();
  const engine = useEngine();
  const project = useCanvasProject();
  const settings = useSettings();
  const groupId = state.groupId as TLShapeId;
  const recipe = useValue("group recipe", () => groupRecipeOf(editor.getShape(groupId)), [editor, groupId]);
  const medium = recipe?.medium ?? "image";
  const definition = mediumDefinition(medium);
  const catalogue = useKnownCatalogue(engine, medium);
  const entry = catalogue?.models.find((model) => model.id === recipe?.model);
  const props = useMemo(() => (recipe && definition ? recipeProps(definition, recipe, entry) : {}), [recipe, definition, entry]);
  const pricing = usePricing(engine, definition ?? mediumDefinition("image")!, recipe?.model);
  const source = useValue(
    "recipe source",
    (): RunSource => {
      const shapes = canvasShapes(editor);
      const selected = editor.getSelectedShapeIds();
      return { kind: "selection", composition: composeSelection({ shapes, selected, instruction: "", medium }), selected, shapes, instruction: "" };
    },
    [editor, medium],
  );
  const estimate = definition && recipe && catalogue ? definition.estimate({ pricing, props, source, entry }) : undefined;
  const progress = useValue("recipe progress", () => recipeRunProgress(editor, groupId), [editor, groupId]);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (busy || !recipe) return;
    setBusy(true);
    try {
      await runGroupRecipe({ editor, engine, project, groupId, recipe, hasKey: settings?.hasKey ?? true });
    } catch (error) {
      showError(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  const label = progress ? `Generating ${progress.settled} / ${progress.total}…` : typeof state.runs === "number" && state.runs > 1 ? `Generate ${state.runs}×` : "Generate";
  const Overlay = definition?.Overlay;
  return (
    <div className={barClass}>
      <Button size="sm" disabled={busy || progress !== undefined} onClick={() => void generate()}>
        {label}
      </Button>
      <span className={hintClass} data-testid="selection-hint">
        {`@${state.name}${estimate === undefined ? "" : ` · ${estimate.replace(/^est\. /, "")}`}`}
      </span>
      <Button variant="ghost" size="sm" onClick={() => recipe && openOnRecipe(editor, groupId, recipe)}>
        Recipe
      </Button>
      {agent}
      {Overlay && <Overlay project={project} onSent={() => undefined} onMenuOpen={() => undefined} />}
    </div>
  );
};

const Bar = ({ state, onGenerate, agent }: { state: Exclude<ToolbarState, { kind: "none" }>; onGenerate: () => void; agent: ReactNode }) => {
  const editor = useEditor();
  const { openArtifact } = useSlots();
  switch (state.kind) {
    case "recipe":
      return <RecipeBar state={state} agent={agent} />;
    case "result":
      return <ResultBar shapeId={state.shapeId as TLShapeId} agent={agent} />;
    case "generating":
      return (
        <div className={barClass}>
          <span className={hintClass}>Generating…</span>
          {agent}
        </div>
      );
    case "open":
      return (
        <div className={barClass}>
          <Button size="sm" onClick={() => openArtifact?.(editor, state.shapeId as TLShapeId)}>
            Open
          </Button>
          {agent}
        </div>
      );
    case "generate":
      return (
        <div className={barClass}>
          <Button size="sm" onClick={onGenerate}>
            Generate
          </Button>
          <span className={hintClass} data-testid="selection-hint">
            {state.hint}
          </span>
          {agent}
        </div>
      );
    case "agent":
      return agent === null ? null : <div className={barClass}>{agent}</div>;
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
