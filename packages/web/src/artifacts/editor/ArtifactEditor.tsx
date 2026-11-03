/**
 * The artifact editor (spec 09): the full-screen view of one artifact. The chat rail on the
 * left filtered to it, the artifact live in the centre, and on the right the Design, Layers and
 * Parameters tabs. Spec 18 adds the Edit and Interact modes and the edit session behind them.
 */
import type { ArtifactShapeProps, ComponentUpdate } from "@unframed/contracts";
import { artifactTitle, dialsWith, editorPreviewViewport, isArtifactKind, mergeDialValues, normaliseDials, previewScale, type ArtifactKind, type ChipElement, type DialsAnnouncement } from "@unframed/domain";
import { AppWindow, ArrowLeft, Clapperboard, Component, ExternalLink, Hand, MousePointer2, PanelLeft, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useEditor, useValue, type TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Sheet, SheetPopup } from "~/components/ui/sheet";
import { Tabs, TabsList, TabsTab } from "~/components/ui/tabs";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";
import { AgentRail } from "../../agent/rail/AgentRail.tsx";
import { useChatClient, useProviders } from "../../agent/store.ts";
import { Tip } from "../../chrome/ui.tsx";
import { useCanvasProject, useEngine } from "../../context.ts";
import { ArtifactFrame, outsideUrlOf, type EditMessage } from "../ArtifactFrame.tsx";
import { kitOf } from "../kit.ts";
import { kitUi } from "../../kits/state.ts";
import { KitModePicker } from "../KitMode.tsx";
import { countUsing } from "../componentPins.ts";
import { updateTagsOf } from "../updates.ts";
import { makeComponent } from "./makeComponent.ts";
import { artifactsOf, previewPort } from "../state.ts";
import { RenderButton } from "../render.tsx";
import { ComponentSection } from "./ComponentSection.tsx";
import { EditOverlay } from "./EditOverlay.tsx";
import { DesignTab } from "./DesignTab.tsx";
import { LayersTab } from "./LayersTab.tsx";
import { COLUMN, ColumnHeader, ParametersBody } from "./Parameters.tsx";
import { PreviewSizeControl, usePreviewSize } from "./PreviewSize.tsx";
import { useEditSession, type EditMode } from "./editSession.ts";
import { makeEditableInstruction, tellAgent } from "./tellAgent.ts";
import { MotionTimeline } from "../timeline/MotionTimeline.tsx";
import { MotionTransport, type TransportZone } from "../timeline/transport.ts";

/** Below these window widths the agent rail, then the parameters column, fold into a kit Sheet (spec 09, the editor). */
const RAIL_FOLDS = "(max-width: 999px)";
const PARAMETERS_FOLD = "(max-width: 719px)";

const useWindowQuery = (query: string): boolean =>
  useSyncExternalStore(
    (changed) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", changed);
      return () => list.removeEventListener("change", changed);
    },
    () => window.matchMedia(query).matches,
  );

export interface ArtifactEditorProps {
  readonly shapeId: TLShapeId;
  readonly onClose: () => void;
  /** Opens another artifact, from the rail's recap card. */
  readonly onOpen: (shapeId: string) => void;
}

type Panel = "design" | "layers" | "parameters";

/** The panel each artifact's editor last showed, for the session: the choice is never written. */
const panelRemembered = new Map<string, Panel>();

/** A key typed where text goes belongs to that field, not to the editor. */
const typingIn = (target: EventTarget | null): boolean => {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  return element.isContentEditable || element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.closest("[contenteditable='true']") !== null;
};

/** Where the focus is, for a motion's transport keys: the page body, the frame, or the strip's time area. Undefined elsewhere (spec 21). */
const transportZone = (): TransportZone | undefined => {
  const active = document.activeElement;
  if (active === null || active === document.body || active === document.documentElement) return "body";
  if (active instanceof HTMLIFrameElement) return "frame";
  if (!(active instanceof HTMLElement)) return undefined;
  // The tldraw container holds the focus after a click on the editor's own surface, where the frame is.
  if (active.classList.contains("tl-container")) return "frame";
  // The time area itself, and the transport's buttons. A row, a bar, a diamond or a menu keeps its own keys.
  if (active.hasAttribute("data-timeline-focus")) return "strip";
  if (active.closest("[data-testid='timeline-transport']") !== null && active.matches("button:not([aria-haspopup])")) return "strip";
  return undefined;
};

const stop = (event: { stopPropagation(): void }) => event.stopPropagation();

/**
 * The editor is portaled beside the canvas but sits inside its React tree, where tldraw's
 * canvas handlers would hear these through the portal and pan or select beneath it.
 */
const KEEP_FROM_CANVAS = {
  onPointerDown: stop,
  onPointerMove: stop,
  onPointerUp: stop,
  onWheel: stop,
  onTouchStart: stop,
  onTouchEnd: stop,
  onDragOver: stop,
  onDrop: stop,
};

const isUndo = (event: KeyboardEvent): boolean => (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z";

/** How often, and how many times, an empty `component.updates` answer is asked again while the canvas shows an update (spec 20). */
const UPDATE_RETRIES = 8;
const UPDATE_RETRY_MS = 250;

export const ArtifactEditor = ({ shapeId, onClose, onOpen }: ArtifactEditorProps) => {
  const editor = useEditor();
  const project = useCanvasProject();
  const engine = useEngine();
  const kit = useValue("project kit", () => kitOf(editor), [editor]);
  const chatClient = useChatClient(engine, project);
  const { statuses } = useProviders(chatClient);
  const facts = useValue(
    "edited artifact",
    () => {
      const shape = editor.getShape(shapeId);
      if (!shape || !isArtifactKind(shape.type)) return undefined;
      const props = shape.props as ArtifactShapeProps;
      return { kind: shape.type as ArtifactKind, file: props.file, title: props.title, fileName: props.fileName, dials: props.dials, mode: props.mode, locked: props.lockedElements ?? [], tag: (props as { tag?: string }).tag ?? "" };
    },
    [editor, shapeId],
  );
  // How many page and motion shapes on this canvas pin the component's tag (spec 20, the editor's header).
  const uses = useValue(
    "component uses",
    () => {
      if (facts?.kind !== "component") return 0;
      const files = editor
        .getCurrentPageShapes()
        .filter((shape) => shape.type === "page" || shape.type === "motion")
        .map((shape) => (shape.props as { file?: string }).file ?? "");
      return countUsing(project, facts.tag, files);
    },
    [editor, project, facts?.kind, facts?.tag],
  );
  const port = useValue("preview port", () => previewPort.get(), []);
  const gone = facts === undefined;

  const session = useEditSession({
    editor,
    engine,
    project,
    shapeId,
    kind: facts?.kind ?? "page",
    file: facts?.file ?? "",
    locked: facts?.locked ?? [],
    kit,
  });
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // The motion strip's values panel, which an Esc closes first (spec 21): the strip sets the closer when it mounts.
  const closePanel = useRef<(() => boolean) | undefined>(undefined);
  // A motion's transport (spec 21): the strip's buttons and keys drive the player through its viewer.
  const [transport] = useState(() => new MotionTransport());
  useEffect(() => () => transport.dispose(), [transport]);
  const onPlayerReady = useCallback((send: (message: unknown) => void) => transport.connect(send), [transport]);
  // Whether the shown artifact is a motion with a file: only then do the transport's keys act.
  const motionShown = useRef(false);
  motionShown.current = facts !== undefined && facts.kind === "motion" && facts.file !== "";

  // Component updates (spec 20): the tags this artifact pins at an older sheet, and the engine's rows for them. The popover opens from the header or the canvas badge.
  const updateKey = useValue("component update tags", () => updateTagsOf(editor, project, facts?.file ?? "").join(","), [editor, project, facts?.file]);
  const [updateRows, setUpdateRows] = useState<ReadonlyArray<ComponentUpdate>>([]);
  const [updatesShown, setUpdatesShown] = useState(false);
  const badgeRequested = useValue("component updates requested", () => artifactsOf(editor).updatesOpen.get() === shapeId, [editor, shapeId]);
  useEffect(() => {
    if (!badgeRequested) return;
    setUpdatesShown(true);
    artifactsOf(editor).updatesOpen.set(undefined);
  }, [badgeRequested, editor]);
  // The engine reads the canvas as it holds it, which can lag an edit made a moment ago (an undo, say): an empty answer while the canvas shows an update is asked again.
  const retries = useRef(0);
  useEffect(() => {
    if (updateKey === "") {
      setUpdateRows([]);
      return;
    }
    let live = true;
    let timer: number | undefined;
    retries.current = 0;
    const ask = (): void => {
      void engine.call("component.updates", { project, shapeId }).then((rows) => {
        if (!live) return;
        setUpdateRows(rows);
        if (rows.length > 0) return;
        if (retries.current < UPDATE_RETRIES) {
          retries.current += 1;
          timer = window.setTimeout(ask, UPDATE_RETRY_MS);
        } else {
          setUpdatesShown(false);
        }
      }, () => undefined);
    };
    ask();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [engine, project, shapeId, updateKey]);
  /** Accepts the update of each listed component: one undoable version, written at once (spec 20, Accepting). */
  const acceptUpdates = useCallback(
    (tags: readonly string[]) => {
      const session = sessionRef.current;
      for (const row of updateRows) if (tags.includes(row.tag)) session.patch({ type: "componentUpdate", tag: row.tag, to: row.to });
      void session.commit();
    },
    [updateRows],
  );
  // The saved dials with the burst's held values over them: the frame and the Parameters tab show what the person set.
  const dials = dialsWith(facts?.dials, session.held);

  /** Locks or unlocks an element: the shape's `lockedElements`, one undo step, and no new version (spec 18, Lock and unlock). */
  const setLocked = useCallback(
    (id: string, on: boolean) => {
      const current = (editor.getShape(shapeId)?.props as { lockedElements?: string[] } | undefined)?.lockedElements ?? [];
      const next = on ? [...current.filter((other) => other !== id), id] : current.filter((other) => other !== id);
      editor.markHistoryStoppingPoint("lock");
      const shape = editor.getShape(shapeId);
      if (shape && next.length === 0) {
        // No lock left: the key goes, so the shape holds no lockedElements at all.
        const { lockedElements: _gone, ...rest } = shape.props as { lockedElements?: string[] };
        editor.store.put([{ ...shape, props: rest } as never]);
      } else {
        editor.updateShape({ id: shapeId, type: facts?.kind ?? "page", props: { lockedElements: next } } as never);
      }
      sessionRef.current.setLocked(next);
    },
    [editor, shapeId, facts?.kind],
  );

  const close = useCallback(() => {
    // Closing saves a pending burst first, as switching mode or element does (spec 18, Bursts).
    void sessionRef.current.commit();
    onClose();
  }, [onClose]);
  const closeRef = useRef(close);
  closeRef.current = close;

  // The artifact deleted by the agent, another tab or an undo: its burst is dropped and the editor closes itself.
  useEffect(() => {
    if (!gone) return;
    sessionRef.current.discard(true);
    onClose();
  }, [gone, onClose]);

  // Cmd-Z in the editor is the editor's: it runs before tldraw's own undo, so the canvas keeps its history out of reach.
  useEffect(() => {
    const onUndo = (event: KeyboardEvent) => {
      if (!isUndo(event) || typingIn(event.target) || typingIn(document.activeElement)) return;
      event.preventDefault();
      event.stopPropagation();
      sessionRef.current.handleKey("z", { shift: event.shiftKey, meta: event.metaKey, ctrl: event.ctrlKey });
    };
    window.addEventListener("keydown", onUndo, true);
    return () => window.removeEventListener("keydown", onUndo, true);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A folded rail or parameters sheet takes its own Esc.
      if (event.key === "Escape" && sheetOpenRef.current) return;
      // Esc ends the innermost open thing first: a motion's values panel (spec 21), then the session's own selections (spec 18).
      if (event.key === "Escape" && !event.defaultPrevented && closePanel.current?.()) {
        event.preventDefault();
        return;
      }
      if (event.defaultPrevented || editor.wasEventAlreadyHandled(event) || typingIn(event.target) || typingIn(document.activeElement)) return;
      if (isUndo(event)) return;
      // The transport takes its keys only where the focus is the frame, the strip or the page body (spec 21, the shortcuts).
      // Space on a focused button is that button's (Play, or a toggle), so the transport leaves it alone.
      const zone = event.key === " " && document.activeElement instanceof HTMLButtonElement ? undefined : transportZone();
      if (motionShown.current && zone !== undefined && transport.handleKey(event.key, { shift: event.shiftKey, meta: event.metaKey, ctrl: event.ctrlKey }, zone)) {
        event.preventDefault();
        return;
      }
      if (sessionRef.current.handleKey(event.key, { shift: event.shiftKey, meta: event.metaKey, ctrl: event.ctrlKey })) {
        event.preventDefault();
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor]);

  const [announcement, setAnnouncement] = useState<DialsAnnouncement>();
  // The old parameters stay until the new version announces its own, or until it has none (spec 09, the editor).
  const clearAnnouncement = useCallback(() => setAnnouncement(undefined), []);
  const post = useRef<((values: unknown) => void) | undefined>(undefined);
  const onReady = useCallback((send: (values: unknown) => void) => {
    post.current = send;
  }, []);
  const onEdit = useCallback(
    (message: EditMessage) => {
      // A motion's keys from the frame (Edit mode only) reach the transport first, as the same keys typed in the editor would.
      if (message.type === "unframed:edit:key" && motionShown.current) {
        const modifiers = { shift: message.shift === true, meta: message.meta === true, ctrl: message.ctrl === true };
        if (transport.handleKey(String(message.key ?? ""), modifiers, "frame")) return;
      }
      sessionRef.current.onFrameMessage(message);
    },
    [transport],
  );
  const onEditReady = useCallback((send: (message: unknown) => void) => sessionRef.current.onFrameReady(send), []);

  const railFolded = useWindowQuery(RAIL_FOLDS);
  const parametersFolded = useWindowQuery(PARAMETERS_FOLD);
  const [sheetChoice, setSheet] = useState<"agent" | "parameters">();
  // A folded column's sheet is open only while its column is folded: a wider window closes it.
  const sheet = (sheetChoice === "agent" && railFolded) || (sheetChoice === "parameters" && parametersFolded) ? sheetChoice : undefined;
  const sheetOpenRef = useRef(false);
  sheetOpenRef.current = sheet !== undefined;

  const [panel, setPanelState] = useState<Panel>(() => (panelRemembered.get(shapeId) ?? "design") as Panel);
  const setPanel = (next: Panel) => {
    panelRemembered.set(shapeId, next);
    setPanelState(next);
  };

  const [size, setSize] = usePreviewSize(project, shapeId);
  const body = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    // A sized preview sits 12 px inside the column, in a 1 px border.
    const measure = () => setArea({ w: element.clientWidth - 26, h: element.clientHeight - 26 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [facts === undefined]);
  const viewport = editorPreviewViewport(size);
  const scale = viewport === undefined ? 1 : previewScale(viewport, area);
  // The editor's column height, which caps the motion timeline at 60 % of it (spec 21). It is the grid's height less its padding,
  // not the centre column's, which shrinks as the timeline grows.
  const grid = useRef<HTMLDivElement>(null);
  const [columnHeight, setColumnHeight] = useState(0);
  // The Design tab's Show on timeline: the element and property, with a count so a repeat of the same request is still a request (spec 21).
  const [reveal, setReveal] = useState<{ readonly element: string; readonly property: string; readonly nonce: number }>();
  useLayoutEffect(() => {
    const element = grid.current;
    if (!element) return;
    const measure = () => {
      const padding = getComputedStyle(element);
      setColumnHeight(element.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [facts === undefined]);

  if (!facts) return null;
  const displayTitle = artifactTitle(facts);
  const title = displayTitle === "" ? shapeId.replace(/^shape:/, "") : displayTitle;
  const component = facts.kind === "component";
  const Icon = facts.kind === "page" ? AppWindow : component ? Component : Clapperboard;
  // A component has no Parameters tab: its values are the sheet's own, and a motion's dials do not apply.
  const shownPanel: Panel = component && panel === "parameters" ? "design" : panel;
  const askAboutComponent = () => {
    // The component's chip names its tag, so the agent can find every instance of it.
    const chip: ChipElement = { elementId: null, liveSelector: facts.tag, tag: facts.tag, label: displayTitle || facts.tag, startTag: `<${facts.tag}>`, text: "", hasChildren: false };
    tellAgent(chatClient, shapeId, [chip]);
  };
  // The component shape a tag names: the Instance section's header and its Go to main component (spec 20). Undefined when no shape holds it.
  const componentOf = (tag: string) => {
    const shape = editor.getCurrentPageShapes().find((candidate) => candidate.type === "component" && (candidate.props as { tag?: string }).tag === tag);
    return shape === undefined ? undefined : { shapeId: shape.id, title: artifactTitle(shape.props as { title?: unknown; fileName?: unknown }), file: (shape.props as { file?: string }).file };
  };
  // The pending burst is written first, as switching the editor does, so the page's last change is not lost.
  const goToMain = (id: string) => {
    void sessionRef.current.commit().then(() => onOpen(id));
  };
  const mode: EditMode = session.mode;
  // The values the frame is running: the saved ones over the artifact's declared defaults, which is what a field's owner is matched against.
  const normalised = announcement === undefined ? undefined : normaliseDials(announcement.config);
  const current = normalised?.ok ? mergeDialValues(normalised.schema, dials ?? null) : dials;
  session.showDials(current ?? {});
  const names: Record<string, string> = {};
  for (const element of session.tree?.elements ?? []) names[element.id] = element.name;

  // A motion with a file has its timeline in a second row under the centre column (spec 21). Below a 1280 px window
  // the timeline spans the centre and right columns, and the right column stops above it.
  const timeline = facts.kind === "motion" && facts.file !== "";
  const columns = railFolded ? (parametersFolded ? "grid-cols-[minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)_320px]") : "grid-cols-[360px_minmax(0,1fr)_320px]";
  // The parameters column's content: the column itself, or the sheet a narrow window folds it into.
  const parametersBody = (
    <>
      <ColumnHeader>
        <Tabs value={shownPanel} onValueChange={(next) => setPanel(String(next) as Panel)} className="h-12 min-w-0">
          <TabsList variant="underline" aria-label="Editor panels">
            <TabsTab value="design">Design</TabsTab>
            <TabsTab value="layers">Layers</TabsTab>
            {!component && (
              <TabsTab value="parameters">
                <SlidersHorizontal aria-hidden />
                Parameters
              </TabsTab>
            )}
          </TabsList>
        </Tabs>
      </ColumnHeader>
      {shownPanel === "design" && (
        <DesignTab
          session={session}
          kind={facts.kind}
          project={project}
          dials={current ?? {}}
          locked={facts.locked}
          kit={kit}
          mode={facts.mode}
          onOpenKit={() => kitUi(editor).update((state) => ({ ...state, open: true }))}
          onTell={(elements) => tellAgent(chatClient, shapeId, elements)}
          onAsk={(field, elements) => tellAgent(chatClient, shapeId, elements, makeEditableInstruction(field))}
          onShowOnTimeline={(element, property) => setReveal({ element, property, nonce: (reveal?.nonce ?? 0) + 1 })}
          component={component ? session.declaration : null}
          componentTitle={component ? displayTitle || facts.tag : undefined}
          onAskComponent={askAboutComponent}
          componentOf={componentOf}
          onUpdateComponent={(tag) => acceptUpdates([tag])}
          onGoToMain={goToMain}
          onMake={(element) => void makeComponent({ client: chatClient, statuses, shapeId: String(shapeId), kind: facts.kind, title: displayTitle, element })}
        />
      )}
      {shownPanel === "layers" && (
        <LayersTab
          session={session}
          kind={facts.kind}
          shapeId={shapeId}
          locked={facts.locked}
          onLock={setLocked}
          onTell={(elements) => tellAgent(chatClient, shapeId, elements)}
        />
      )}
      {shownPanel === "parameters" && (
        <ParametersBody
          shapeId={shapeId}
          kind={facts.kind}
          title={title}
          announcement={announcement}
          saved={dials}
          onWrite={(values) => session.releaseDials(values as Record<string, unknown>)}
          post={(values) => post.current?.(values)}
        />
      )}
    </>
  );
  return (
    // Full height. tldraw's watermark stays over its bottom-right corner: tldraw.css lifts the tldraw container above this layer.
    <div
      ref={grid}
      data-testid="artifact-editor"
      className={cn(
        "pointer-events-auto absolute inset-0 z-[700] box-border grid gap-3 bg-background p-3 font-sans text-foreground",
        timeline ? "grid-rows-[minmax(0,1fr)_auto]" : "grid-rows-[minmax(0,1fr)]",
        columns,
      )}
      {...KEEP_FROM_CANVAS}
    >
      {!railFolded && (
        <section data-editor-column="rail" className={cn(COLUMN, "col-start-1 row-span-full")}>
          <AgentRail project={project} embedded filterTo={[shapeId]} onOpenEditor={onOpen} onClose={close} />
        </section>
      )}
      <section data-editor-column="centre" className={cn(COLUMN, railFolded ? "col-start-1" : "col-start-2", "row-start-1")} aria-label={`Editing ${title}`}>
        {/* A container, so a narrow column folds its labels into icons rather than overflow. */}
        <ColumnHeader className="@container/editor-header gap-1">
          <Tip label="Back to canvas (Esc)">
            <Button variant="ghost" size="icon" className="shrink-0" aria-label="Back to canvas" onClick={close}>
              <ArrowLeft aria-hidden />
            </Button>
          </Tip>
          {railFolded && (
            <Tip label="Show agent">
              <Button variant="outline" size="sm" className="shrink-0" aria-label="Show agent" onClick={() => setSheet("agent")}>
                <PanelLeft aria-hidden />
                <span className="@max-[520px]/editor-header:sr-only">Show agent</span>
              </Button>
            </Tip>
          )}
          <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          {/* The title and the use count keep their width and the kind word truncates first, so neither is squeezed away (spec 09, the header). */}
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <Tip label={title}>
              <span data-testid="artifact-editor-title" className="min-w-0 truncate text-sm font-semibold">
                {title}
              </span>
            </Tip>
            <span data-testid="artifact-editor-kind" className="min-w-0 shrink truncate text-sm text-muted-foreground @max-[760px]/editor-header:hidden">
              {facts.kind}
            </span>
            {component && uses > 0 && (
              <span data-testid="artifact-editor-uses" className="shrink-0 text-sm text-muted-foreground @max-[520px]/editor-header:hidden">
                {uses === 1 ? "Used in 1 artifact" : `Used in ${uses} artifacts`}
              </span>
            )}
          </span>
          {facts.file !== "" && (
            <ToggleGroup
              aria-label="Mode"
              variant="default"
              size="xs"
              className="shrink-0"
              value={[mode]}
              onValueChange={(next) => {
                const [picked] = next as EditMode[];
                if (picked === "edit" || picked === "interact") session.setMode(picked);
              }}
            >
              <Tip label="Edit (V)">
                <Toggle value="edit" aria-label="Edit">
                  <MousePointer2 aria-hidden />
                  <span className="@max-[520px]/editor-header:sr-only">Edit</span>
                </Toggle>
              </Tip>
              <Tip label="Interact (I)">
                <Toggle value="interact" aria-label="Interact">
                  <Hand aria-hidden />
                  <span className="@max-[520px]/editor-header:sr-only">Interact</span>
                </Toggle>
              </Tip>
            </ToggleGroup>
          )}
          {facts.file !== "" && kit && <KitModePicker shapeId={shapeId} variant="header" />}
          {facts.file !== "" && updateRows.length > 0 && (
            <Popover open={updatesShown} onOpenChange={setUpdatesShown}>
              <PopoverTrigger render={<Button variant="outline" size="sm" className="shrink-0" aria-label="Component updates available" />}>
                <Component aria-hidden />
                <span className="@max-[520px]/editor-header:sr-only">Component updates available</span>
              </PopoverTrigger>
              <PopoverPopup side="bottom" align="end" padding="compact" className="w-80" aria-label="Component updates" initialFocus={false}>
                <div className="flex flex-col gap-3">
                  {updateRows.map((row) => {
                    const uses = session.tree?.elements.filter((element) => element.tag === row.tag).length ?? 0;
                    return (
                      <div key={row.tag} className="flex flex-col gap-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 truncate text-sm font-medium">{row.title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{uses === 1 ? "1 instance" : `${uses} instances`}</span>
                          <Button variant="outline" size="xs" className="ml-auto shrink-0" onClick={() => acceptUpdates([row.tag])}>
                            Update
                          </Button>
                        </div>
                        {row.warnings.map((warning) => (
                          <p key={warning} className="m-0 text-xs text-warning-foreground">{warning}</p>
                        ))}
                      </div>
                    );
                  })}
                  {updateRows.length >= 2 && (
                    <div className="border-t pt-2">
                      <Button variant="outline" size="sm" onClick={() => acceptUpdates(updateRows.map((row) => row.tag))}>
                        Update all
                      </Button>
                    </div>
                  )}
                </div>
              </PopoverPopup>
            </Popover>
          )}
          {facts.file !== "" && <PreviewSizeControl size={size} onChange={setSize} scale={scale} />}
          {facts.kind === "motion" && facts.file !== "" && <RenderButton shapeId={shapeId} />}
          {facts.file !== "" && port !== undefined && (
            <Tip label="Open in a new tab">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                aria-label="Open in a new tab"
                onClick={() => {
                  // Opened first, while the click still counts as the person's: the tab waits for
                  // the pointer the engine writes next.
                  window.open(outsideUrlOf(project, shapeId, facts.kind, facts.file, port), "_blank", "noopener,noreferrer");
                  engine.call("artifact.openLive", { project, shapeId }).catch(() => undefined);
                }}
              >
                <ExternalLink aria-hidden />
              </Button>
            </Tip>
          )}
          {parametersFolded && (
            <Tip label="Show parameters">
              <Button variant="outline" size="sm" className="shrink-0" aria-label="Show parameters" onClick={() => setSheet("parameters")}>
                <SlidersHorizontal aria-hidden />
                <span className="@max-[520px]/editor-header:sr-only">Show parameters</span>
              </Button>
            </Tip>
          )}
        </ColumnHeader>
        <div ref={body} className={cn("relative flex min-h-0 flex-1", viewport !== undefined && "items-center justify-center overflow-hidden")}>
          {facts.file === "" ? (
            <p className="m-auto p-6 text-center text-sm text-muted-foreground">{`This ${facts.kind} has no file yet. Ask the agent to write one.`}</p>
          ) : port === undefined ? null : (
            // The same two boxes hold the frame at every size, so changing the size never reloads the document.
            <div
              data-testid="artifact-preview"
              className={cn(viewport === undefined ? "size-full" : "box-content shrink-0 overflow-hidden border")}
              style={viewport === undefined ? undefined : { width: viewport.width * scale, height: viewport.height * scale }}
            >
              <div
                className={cn("relative", viewport === undefined && "size-full")}
                style={viewport === undefined ? undefined : { width: viewport.width, height: viewport.height, transform: `scale(${scale})`, transformOrigin: "0 0" }}
              >
                <ArtifactFrame
                  project={project}
                  kind={facts.kind}
                  file={facts.file}
                  previewPort={port}
                  dials={dials}
                  kit={kit}
                  mode={facts.mode}
                  interactive
                  lazy={false}
                  onAnnounce={setAnnouncement}
                  onReady={onReady}
                  editable
                  onEdit={onEdit}
                  onEditReady={onEditReady}
                  onSwapped={clearAnnouncement}
                  onPlayer={transport.onPlayerMessage}
                  onPlayerReady={onPlayerReady}
                />
                {mode === "edit" && (
                  <EditOverlay hovered={session.hovered} layerHover={session.layerHover} selection={session.selection} reports={session.reports} boxes={session.boxes} copies={session.copies} names={names} />
                )}
              </div>
            </div>
          )}
        </div>
      </section>
      {/* The bottom 40 px hold tldraw's watermark, which sits over this corner, so the controls end above it. */}
      {!parametersFolded && (
        <section data-editor-column="parameters" className={cn(COLUMN, railFolded ? "col-start-2" : "col-start-3", "row-span-full pb-10 max-[1279px]:row-span-1 max-[1279px]:row-start-1")}>
          {parametersBody}
        </section>
      )}
      {timeline && (
        <MotionTimeline
          key={shapeId}
          title={title}
          closePanel={closePanel}
          engine={engine}
          project={project}
          file={facts.file}
          session={session}
          dials={current ?? {}}
          schema={normalised?.ok ? normalised.schema : undefined}
          locked={facts.locked}
          column={columnHeight}
          transport={transport}
          onAsk={(field, elements) => tellAgent(chatClient, shapeId, elements, makeEditableInstruction(field))}
          kit={kit}
          mode={facts.mode}
          reveal={reveal}
          className={railFolded ? (parametersFolded ? "col-start-1 row-start-2" : "col-start-1 col-span-2 row-start-2") : "col-start-2 row-start-2 max-[1279px]:col-span-2"}
        />
      )}
      <Sheet open={sheet === "agent"} onOpenChange={(open) => setSheet(open ? "agent" : undefined)}>
        <SheetPopup side="left" aria-label="Agent" showCloseButton={false} className="w-[min(88vw,24rem)]">
          <AgentRail project={project} inSheet filterTo={[shapeId]} onOpenEditor={onOpen} onClose={() => setSheet(undefined)} />
        </SheetPopup>
      </Sheet>
      <Sheet open={sheet === "parameters"} onOpenChange={(open) => setSheet(open ? "parameters" : undefined)}>
        <SheetPopup side="right" aria-label="Parameters" showCloseButton={false} className="w-[min(88vw,24rem)]">
          <div className="flex min-h-0 flex-1 flex-col">{parametersBody}</div>
        </SheetPopup>
      </Sheet>
    </div>
  );
};
