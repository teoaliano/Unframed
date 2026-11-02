/**
 * The artifact editor (spec 09): the full-screen view of one artifact. The chat rail on the
 * left filtered to it, the artifact live in the centre, and on the right the Design, Layers and
 * Parameters tabs. Spec 18 adds the Edit and Interact modes and the edit session behind them.
 */
import type { ArtifactShapeProps } from "@unframed/contracts";
import { artifactTitle, dialsWith, editorPreviewViewport, isArtifactKind, mergeDialValues, normaliseDials, previewScale, type ArtifactKind, type ChipElement, type DialsAnnouncement } from "@unframed/domain";
import { AppWindow, ArrowLeft, Clapperboard, Component, ExternalLink, Hand, MousePointer2, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEditor, useValue, type TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { Tabs, TabsList, TabsTab } from "~/components/ui/tabs";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";
import { AgentRail } from "../../agent/rail/AgentRail.tsx";
import { useChatClient } from "../../agent/store.ts";
import { Tip } from "../../chrome/ui.tsx";
import { useCanvasProject, useEngine } from "../../context.ts";
import { ArtifactFrame, outsideUrlOf, type EditMessage } from "../ArtifactFrame.tsx";
import { kitOf } from "../kit.ts";
import { kitUi } from "../../kits/state.ts";
import { KitModePicker } from "../KitMode.tsx";
import { countUsing } from "../componentPins.ts";
import { previewPort } from "../state.ts";
import { RenderButton } from "../render.tsx";
import { ComponentSection } from "./ComponentSection.tsx";
import { EditOverlay } from "./EditOverlay.tsx";
import { DesignTab } from "./DesignTab.tsx";
import { LayersTab } from "./LayersTab.tsx";
import { COLUMN, ColumnHeader, ParametersBody } from "./Parameters.tsx";
import { PreviewSizeControl, usePreviewSize } from "./PreviewSize.tsx";
import { useEditSession, type EditMode } from "./editSession.ts";
import { makeEditableInstruction, tellAgent } from "./tellAgent.ts";

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

export const ArtifactEditor = ({ shapeId, onClose, onOpen }: ArtifactEditorProps) => {
  const editor = useEditor();
  const project = useCanvasProject();
  const engine = useEngine();
  const kit = useValue("project kit", () => kitOf(editor), [editor]);
  const chatClient = useChatClient(engine, project);
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
      if (event.defaultPrevented || editor.wasEventAlreadyHandled(event) || typingIn(event.target) || typingIn(document.activeElement)) return;
      if (isUndo(event)) return;
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
  const onEdit = useCallback((message: EditMessage) => sessionRef.current.onFrameMessage(message), []);
  const onEditReady = useCallback((send: (message: unknown) => void) => sessionRef.current.onFrameReady(send), []);

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
  const mode: EditMode = session.mode;
  // The values the frame is running: the saved ones over the artifact's declared defaults, which is what a field's owner is matched against.
  const normalised = announcement === undefined ? undefined : normaliseDials(announcement.config);
  const current = normalised?.ok ? mergeDialValues(normalised.schema, dials ?? null) : dials;
  session.showDials(current ?? {});
  const names: Record<string, string> = {};
  for (const element of session.tree?.elements ?? []) names[element.id] = element.name;

  return (
    // Full height. tldraw's watermark stays over its bottom-right corner: tldraw.css lifts the tldraw container above this layer.
    <div
      data-testid="artifact-editor"
      className="pointer-events-auto absolute inset-0 z-[700] box-border grid grid-cols-[360px_minmax(0,1fr)_320px] gap-3 bg-background p-3 font-sans text-foreground"
      {...KEEP_FROM_CANVAS}
    >
      <section data-editor-column="rail" className={COLUMN}>
        <AgentRail project={project} embedded filterTo={[shapeId]} onOpenEditor={onOpen} onClose={close} />
      </section>
      <section data-editor-column="centre" className={COLUMN} aria-label={`Editing ${title}`}>
        {/* A container, so a narrow column folds its labels into icons rather than overflow. */}
        <ColumnHeader className="@container/editor-header gap-1">
          <Tip label="Back to canvas (Esc)">
            <Button variant="ghost" size="icon" className="shrink-0" aria-label="Back to canvas" onClick={close}>
              <ArrowLeft aria-hidden />
            </Button>
          </Tip>
          <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex min-w-10 flex-1 items-baseline gap-2">
            <span data-testid="artifact-editor-title" className="truncate text-sm font-semibold">
              {title}
            </span>
            <span data-testid="artifact-editor-kind" className="shrink-0 text-sm text-muted-foreground @max-[520px]/editor-header:hidden">
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
              <Toggle value="edit" aria-label="Edit" title="Edit (V)">
                <MousePointer2 aria-hidden />
                <span className="@max-[520px]/editor-header:sr-only">Edit</span>
              </Toggle>
              <Toggle value="interact" aria-label="Interact" title="Interact (I)">
                <Hand aria-hidden />
                <span className="@max-[520px]/editor-header:sr-only">Interact</span>
              </Toggle>
            </ToggleGroup>
          )}
          {facts.file !== "" && kit && <KitModePicker shapeId={shapeId} variant="header" />}
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
      <section data-editor-column="parameters" className={cn(COLUMN, "pb-10")}>
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
            component={component ? session.declaration : null}
            componentTitle={component ? displayTitle || facts.tag : undefined}
            onAskComponent={askAboutComponent}
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
      </section>
    </div>
  );
};
