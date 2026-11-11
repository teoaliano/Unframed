import { resultMetaOf, UnframedError } from "@unframed/contracts";
import { useFeature } from "../features.ts";
import { audioLine, composeSelection, labelLevel, readRef, resultLine, toolbarState, type ToolbarState } from "@unframed/domain";
import { audioDurationOf } from "../canvas/shapes/audio.tsx";
import { renamingShape } from "../canvas/rename.ts";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useEditor, useValue, type Editor, type TLShapeId } from "tldraw";
import { GripVertical } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { groupRecipeOf } from "../canvas/groupRecipes.ts";
import { Tip } from "../chrome/ui.tsx";
import { useSlots } from "../chrome/slots.ts";
import { useCanvasProject, useEngine, useSettings } from "../context.ts";
import { showError, showErrorAction } from "../toasts.tsx";
import { openSettings } from "../settings/settingsEvents.ts";
import { useKnownCatalogue, usePricing } from "./catalogue.ts";
import { Composer } from "./composer/Composer.tsx";
import { assetOf, canvasShapes, resultShapes, toolbarShape } from "./facts.ts";
import { canvasRoom, placeFloating, type ScreenBox } from "./floating.ts";
import { mediumDefinition, type RunSource } from "./mediumRegistry.ts";
import { NoKeyError, openOnRecipe, recipeProps, recipeRunProgress, runGroupRecipe } from "./recipeRuns.ts";
import { closeComposer, composerState, leaveRecipeMode, openComposer } from "./state.ts";
import { composerGlassClass } from "../chrome/composerSurface.ts";
import { useWheelToCanvas } from "../canvas/wheelToCanvas.ts";
import { NodeRunButtons, selectionNodeCount } from "../nodes/NodeChrome.tsx";

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

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

const LABEL_BAND = 22;

const selectionOnScreen = (editor: Editor): ScreenBox | undefined => {
  const bounds = editor.getSelectionPageBounds();
  if (!bounds) return undefined;
  const labelled = labelLevel(editor.getZoomLevel()) !== "off" && editor.getSelectedShapes().some((shape) => readRef(shape) !== undefined);
  const band = labelled ? LABEL_BAND : 0;
  const topLeft = editor.pageToViewport({ x: bounds.minX, y: bounds.minY - band });
  const bottomRight = editor.pageToViewport({ x: bounds.maxX, y: bounds.maxY });
  return { x: topLeft.x, y: topLeft.y, w: bottomRight.x - topLeft.x, h: bottomRight.y - topLeft.y };
};

const Floating = ({ target, hidden, expanded, framed, children }: { target: ScreenBox | undefined; hidden: boolean; expanded: boolean; framed: boolean; children: ReactNode }) => {
  const editor = useEditor();
  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>();
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
    const measure = () => {
      const outer = root.current;
      const border = outer ? outer.offsetWidth - outer.clientWidth : 0;
      const w = element.offsetWidth + border;
      const h = element.offsetHeight + border;
      setSize((previous) => (previous?.w === w && previous.h === h ? previous : { w, h }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const [roomTick, setRoomTick] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setRoomTick((tick) => tick + 1)));
    return () => cancelAnimationFrame(frame);
  }, [target, editor]);
  const canvas = useValue("canvas room", () => canvasRoom(editor), [editor, roomTick]);
  const place = size && target ? placeFloating(target, size, canvas) : undefined;

  return (
    <div
      ref={root}
      className={cn(
        "pointer-events-auto absolute z-[500] box-border overflow-hidden font-sans text-foreground data-[morphing=true]:transition-[left,top,width,height,border-radius,background-color,box-shadow] data-[morphing=true]:duration-200 data-[morphing=true]:ease-out motion-reduce:data-[morphing=true]:transition-none",
        !expanded ? "rounded-xl border shadow-lg/5 surface-glass" : framed ? `${composerGlassClass} rounded-3xl border shadow-composer dark:shadow-none` : "rounded-3xl",
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

const rowClass = "flex items-center gap-1.5";
const barClass = `${rowClass} whitespace-nowrap p-1`;
const hintClass = "px-1 text-xs text-muted-foreground";

const DragHandle = () => {
  const editor = useEditor();
  const drag = useRef<{ readonly from: { x: number; y: number }; readonly shapes: ReadonlyArray<{ id: TLShapeId; type: string; page: { x: number; y: number } }> }>(undefined);
  return (
    <Tip label="Drag to move" side="top">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Drag to move"
        className="cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          editor.markHistoryStoppingPoint("drag handle");
          drag.current = {
            from: editor.screenToPage({ x: event.clientX, y: event.clientY }),
            shapes: editor.getSelectedShapes().map((shape) => ({ id: shape.id, type: shape.type, page: editor.getShapePageTransform(shape).point() })),
          };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          const now = editor.screenToPage({ x: event.clientX, y: event.clientY });
          const dx = now.x - start.from.x;
          const dy = now.y - start.from.y;
          editor.updateShapes(
            start.shapes.map((shape) => {
              const local = editor.getPointInParentSpace(shape.id, { x: shape.page.x + dx, y: shape.page.y + dy });
              return { id: shape.id, type: shape.type, x: local.x, y: local.y };
            }) as Parameters<typeof editor.updateShapes>[0],
          );
        }}
        onPointerUp={() => {
          drag.current = undefined;
        }}
        onPointerCancel={() => {
          drag.current = undefined;
        }}
      >
        <GripVertical aria-hidden />
      </Button>
    </Tip>
  );
};

const AgentButton = ({ onOpen }: { onOpen: () => void }) => {
  const { agentToolbarButton: Registered } = useSlots();
  return (
    <>
      {Registered ? (
        <Registered onOpen={onOpen} />
      ) : (
        <Button variant="outline" size="sm" onClick={onOpen}>
          Agent
        </Button>
      )}
    </>
  );
};

const ResultBar = ({ state, onGenerate, agent }: { state: Extract<ToolbarState, { kind: "result" }>; onGenerate: () => void; agent: ReactNode }) => {
  const editor = useEditor();
  const engine = useEngine();
  const project = useCanvasProject();
  const shapeId = state.shapeId as TLShapeId;
  const line = useValue(
    "result line",
    () => {
      const shape = editor.getShape(shapeId);
      const result = shape ? resultMetaOf(shape) : undefined;
      if (!shape || !result) return undefined;
      if (result.medium === "audio") {
        const seconds = audioDurationOf(shape.id);
        return audioLine({ model: result.model, durationMs: seconds === undefined ? undefined : seconds * 1000, credits: result.credits });
      }
      const asset = assetOf(editor, shape)?.props as { w?: number; h?: number } | undefined;
      return resultLine({ model: result.model, width: asset?.w, height: asset?.h, cost: result.cost, provider: result.provider, listPrice: result.listPrice });
    },
    [editor, shapeId],
  );

  const regenerate = async () => {
    try {
      const recipe = await engine.call("recipe.read", { project, shapeId });
      openComposer(editor, "generate", { shapeId, recipe, selection: editor.getSelectedShapeIds() });
    } catch (error) {
      showError(messageOf(error));
    }
  };

  return (
    <div className="flex flex-col gap-0.5 whitespace-nowrap p-1">
      <div className={rowClass}>
        <Button variant={state.generate ? "outline" : "default"} size="sm" onClick={() => void regenerate()}>
          Regenerate
        </Button>
        {agent}
        {state.generate && (
          <Button size="sm" onClick={onGenerate}>
            Generate
          </Button>
        )}
      </div>
      {line !== undefined && (
        <div className="px-1.5 py-0.5 text-xs text-muted-foreground tabular-nums" data-testid="result-line">
          {line}
        </div>
      )}
    </div>
  );
};

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
      await runGroupRecipe({ editor, engine, project, groupId, recipe, keys: settings ?? { hasKey: true, hasVercelKey: false }, hasElevenLabsKey: settings?.hasElevenLabsKey ?? true });
    } catch (error) {
      if (error instanceof NoKeyError) showErrorAction(error.message, "Open Settings", () => openSettings("generation"));
      else showError(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  const label = progress ? `Generating ${progress.settled} / ${progress.total}…` : typeof state.runs === "number" && state.runs > 1 ? `Generate ${state.runs}×` : "Generate";
  const Overlay = definition?.Overlay;
  return (
    <div className={barClass}>
      {state.drag && <DragHandle />}
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

const Bar = ({ state, onGenerate, agent, nodes }: { state: Exclude<ToolbarState, { kind: "none" }>; onGenerate: () => void; agent: ReactNode; nodes: number }) => {
  const editor = useEditor();
  const { openArtifact, renderButton: Render, parametersButton: ParametersToggle, kitModeButton: KitModeToggle, scaleButton: Scale } = useSlots();
  switch (state.kind) {
    case "recipe":
      return <RecipeBar state={state} agent={agent} />;
    case "result":
      return <ResultBar state={state} onGenerate={onGenerate} agent={agent} />;
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
          <DragHandle />
          <Button size="sm" onClick={() => openArtifact?.(editor, state.shapeId as TLShapeId)}>
            Editor
          </Button>
          {Render && editor.getShape(state.shapeId as TLShapeId)?.type === "motion" && <Render shapeId={state.shapeId as TLShapeId} />}
          {ParametersToggle && editor.getShape(state.shapeId as TLShapeId)?.type !== "component" && <ParametersToggle shapeId={state.shapeId as TLShapeId} />}
          {KitModeToggle && <KitModeToggle shapeId={state.shapeId as TLShapeId} />}
          {Scale && editor.getShape(state.shapeId as TLShapeId)?.type !== "component" && <Scale shapeId={state.shapeId as TLShapeId} />}
          {agent}
        </div>
      );
    case "generate":
      return (
        <div className={barClass}>
          {state.drag && <DragHandle />}
          <span className={hintClass} data-testid="selection-hint">
            {state.hint}
          </span>
          {agent}
          <NodeRunButtons primary={false} />
          <Button size="sm" onClick={onGenerate}>
            Generate
          </Button>
        </div>
      );
    case "agent":
      return agent === null && !state.drag && nodes === 0 ? null : (
        <div className={barClass}>
          {state.drag && <DragHandle />}
          {nodes > 1 && (
            <span className={hintClass} data-testid="selection-hint">
              {`${nodes} nodes`}
            </span>
          )}
          {agent}
          <NodeRunButtons primary />
        </div>
      );
  }
};

export const SelectionToolbar = () => {
  const editor = useEditor();
  const project = useCanvasProject();
  const { agentTray } = useSlots();
  const composer = useValue("composer", () => composerState(editor).get(), [editor]);
  const hidden = useValue("toolbar hidden", () => hiddenByGesture(editor) || renamingShape(editor).get() !== undefined, [editor]);
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

  useEffect(() => {
    const { mode, recipe } = composerState(editor).get();
    if (selectionKey === "" && mode !== "bar") closeComposer(editor);
    else if (recipe && recipe.selection.join(" ") !== selectionKey) leaveRecipeMode(editor);
  }, [editor, selectionKey]);

  const collapse = useCallback(() => closeComposer(editor), [editor]);
  const nodesOn = useFeature("nodes");
  const nodes = useValue("selected nodes", () => (nodesOn ? selectionNodeCount(editor) : 0), [editor, nodesOn]);
  const agent = agentTray ? <AgentButton onOpen={() => openComposer(editor, "agent")} /> : null;

  if (selectionKey === "") return null;
  if (!expanded && (state === undefined || state.kind === "none" || (state.kind === "agent" && agent === null && !state.drag && nodes === 0))) return null;

  return (
    <Floating target={target ?? lastTarget.current} hidden={hidden} expanded={expanded} framed={composer.mode !== "agent"}>
      {expanded ? (
        <Composer mode={composer.mode === "agent" ? "agent" : "generate"} project={project} recipe={composer.recipe} onCollapse={collapse} />
      ) : state && state.kind !== "none" ? (
        <Bar state={state} onGenerate={() => openComposer(editor, "generate")} agent={agent} nodes={nodes} />
      ) : null}
    </Floating>
  );
};
