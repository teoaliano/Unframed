import type { ArtifactShapeProps, ComponentUpdate } from "@unframed/contracts";
import {
  artifactTitle,
  dialsWith,
  editorPreviewViewport,
  isArtifactKind,
  mergeDialValues,
  normaliseDials,
  previewScale,
  type ArtifactKind,
  type ChipElement,
  type DialsAnnouncement,
} from "@unframed/domain";
import {
  AppWindow,
  ArrowLeft,
  Clapperboard,
  Component,
  ExternalLink,
  Hand,
  MousePointer2,
  PanelLeft,
  SlidersHorizontal,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
import {
  ArtifactFrame,
  outsideUrlOf,
  type EditMessage,
} from "../ArtifactFrame.tsx";
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
  readonly onOpen: (shapeId: string) => void;
}

type Panel = "design" | "layers" | "parameters";

const panelRemembered = new Map<string, Panel>();

const typingIn = (target: EventTarget | null): boolean => {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  return (
    element.isContentEditable ||
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.closest("[contenteditable='true']") !== null
  );
};

const transportZone = (): TransportZone | undefined => {
  const active = document.activeElement;
  if (
    active === null ||
    active === document.body ||
    active === document.documentElement
  )
    return "body";
  if (active instanceof HTMLIFrameElement) return "frame";
  if (!(active instanceof HTMLElement)) return undefined;
  if (active.classList.contains("tl-container")) return "frame";
  if (active.hasAttribute("data-timeline-focus")) return "strip";
  if (
    active.closest("[data-testid='timeline-transport']") !== null &&
    active.matches("button:not([aria-haspopup])")
  )
    return "strip";
  return undefined;
};

const stop = (event: { stopPropagation(): void }) => event.stopPropagation();

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

const isUndo = (event: KeyboardEvent): boolean =>
  (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z";

const UPDATE_RETRIES = 8;
const UPDATE_RETRY_MS = 250;

export const ArtifactEditor = ({
  shapeId,
  onClose,
  onOpen,
}: ArtifactEditorProps) => {
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
      return {
        kind: shape.type as ArtifactKind,
        file: props.file,
        title: props.title,
        fileName: props.fileName,
        dials: props.dials,
        mode: props.mode,
        locked: props.lockedElements ?? [],
        tag: (props as { tag?: string }).tag ?? "",
      };
    },
    [editor, shapeId],
  );
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
  const closePanel = useRef<(() => boolean) | undefined>(undefined);
  const [transport] = useState(() => new MotionTransport());
  useEffect(() => () => transport.dispose(), [transport]);
  const onPlayerReady = useCallback(
    (send: (message: unknown) => void) => transport.connect(send),
    [transport],
  );
  const motionShown = useRef(false);
  motionShown.current =
    facts !== undefined && facts.kind === "motion" && facts.file !== "";

  const updateKey = useValue(
    "component update tags",
    () => updateTagsOf(editor, project, facts?.file ?? "").join(","),
    [editor, project, facts?.file],
  );
  const [updateRows, setUpdateRows] = useState<ReadonlyArray<ComponentUpdate>>(
    [],
  );
  const [updatesShown, setUpdatesShown] = useState(false);
  const [updateNote, setUpdateNote] = useState("");
  const updateFocus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (updateFocus.current === undefined) return;
    const next = updateRows.find((row) => row.tag === updateFocus.current);
    const target = next === undefined ? updateRows[0] : next;
    updateFocus.current = undefined;
    const button = target
      ? document.querySelector<HTMLElement>(`[data-update-tag="${target.tag}"]`)
      : null;
    (
      button ?? document.querySelector<HTMLElement>("[data-updates-title]")
    )?.focus();
  }, [updateRows]);
  const badgeRequested = useValue(
    "component updates requested",
    () => artifactsOf(editor).updatesOpen.get() === shapeId,
    [editor, shapeId],
  );
  useEffect(() => {
    if (!badgeRequested) return;
    setUpdatesShown(true);
    artifactsOf(editor).updatesOpen.set(undefined);
  }, [badgeRequested, editor]);
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
      void engine.call("component.updates", { project, shapeId }).then(
        (rows) => {
          if (!live) return;
          setUpdateRows(rows);
          if (rows.length > 0) return;
          if (retries.current < UPDATE_RETRIES) {
            retries.current += 1;
            timer = window.setTimeout(ask, UPDATE_RETRY_MS);
          } else {
            setUpdatesShown(false);
          }
        },
        () => undefined,
      );
    };
    ask();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [engine, project, shapeId, updateKey]);
  const acceptUpdates = useCallback(
    async (tags: readonly string[]) => {
      const session = sessionRef.current;
      await session.commit();
      const accepted = updateRows.filter((row) => tags.includes(row.tag));
      for (const row of accepted)
        session.patch({ type: "componentUpdate", tag: row.tag, to: row.to });
      const rest = updateRows.find((row) => !tags.includes(row.tag));
      updateFocus.current = rest?.tag;
      setUpdateNote(`Updated ${accepted.map((row) => row.title).join(", ")}.`);
      await session.commit();
    },
    [updateRows],
  );
  const dials = dialsWith(facts?.dials, session.held);

  const setLocked = useCallback(
    (id: string, on: boolean) => {
      const current =
        (
          editor.getShape(shapeId)?.props as
            { lockedElements?: string[] } | undefined
        )?.lockedElements ?? [];
      const next = on
        ? [...current.filter((other) => other !== id), id]
        : current.filter((other) => other !== id);
      editor.markHistoryStoppingPoint("lock");
      const shape = editor.getShape(shapeId);
      if (shape && next.length === 0) {
        const { lockedElements: _gone, ...rest } = shape.props as {
          lockedElements?: string[];
        };
        editor.store.put([{ ...shape, props: rest } as never]);
      } else {
        editor.updateShape({
          id: shapeId,
          type: facts?.kind ?? "page",
          props: { lockedElements: next },
        } as never);
      }
      sessionRef.current.setLocked(next);
    },
    [editor, shapeId, facts?.kind],
  );

  const close = useCallback(() => {
    void sessionRef.current.commit();
    onClose();
  }, [onClose]);
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!gone) return;
    sessionRef.current.discard(true);
    onClose();
  }, [gone, onClose]);

  useEffect(() => {
    const onUndo = (event: KeyboardEvent) => {
      if (
        !isUndo(event) ||
        typingIn(event.target) ||
        typingIn(document.activeElement)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      sessionRef.current.handleKey("z", {
        shift: event.shiftKey,
        meta: event.metaKey,
        ctrl: event.ctrlKey,
      });
    };
    window.addEventListener("keydown", onUndo, true);
    return () => window.removeEventListener("keydown", onUndo, true);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && sheetOpenRef.current) return;
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        closePanel.current?.()
      ) {
        event.preventDefault();
        return;
      }
      if (
        event.defaultPrevented ||
        editor.wasEventAlreadyHandled(event) ||
        typingIn(event.target) ||
        typingIn(document.activeElement)
      )
        return;
      if (isUndo(event)) return;
      const zone =
        event.key === " " && document.activeElement instanceof HTMLButtonElement
          ? undefined
          : transportZone();
      if (
        motionShown.current &&
        zone !== undefined &&
        transport.handleKey(
          event.key,
          { shift: event.shiftKey, meta: event.metaKey, ctrl: event.ctrlKey },
          zone,
        )
      ) {
        event.preventDefault();
        return;
      }
      if (
        sessionRef.current.handleKey(event.key, {
          shift: event.shiftKey,
          meta: event.metaKey,
          ctrl: event.ctrlKey,
        })
      ) {
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
  const clearAnnouncement = useCallback(() => setAnnouncement(undefined), []);
  const post = useRef<((values: unknown) => void) | undefined>(undefined);
  const onReady = useCallback((send: (values: unknown) => void) => {
    post.current = send;
  }, []);
  const onEdit = useCallback(
    (message: EditMessage) => {
      if (message.type === "unframed:edit:key" && motionShown.current) {
        const modifiers = {
          shift: message.shift === true,
          meta: message.meta === true,
          ctrl: message.ctrl === true,
        };
        if (transport.handleKey(String(message.key ?? ""), modifiers, "frame"))
          return;
      }
      if (message.type === "unframed:edit:key" && message.key === "Escape") {
        if (!sessionRef.current.handleKey("Escape", { shift: false, meta: false, ctrl: false })) closeRef.current();
        return;
      }
      sessionRef.current.onFrameMessage(message);
    },
    [transport],
  );
  const onEditReady = useCallback(
    (send: (message: unknown) => void) => sessionRef.current.onFrameReady(send),
    [],
  );

  const railFolded = useWindowQuery(RAIL_FOLDS);
  const parametersFolded = useWindowQuery(PARAMETERS_FOLD);
  const [sheetChoice, setSheet] = useState<"agent" | "parameters">();
  const sheet =
    (sheetChoice === "agent" && railFolded) ||
    (sheetChoice === "parameters" && parametersFolded)
      ? sheetChoice
      : undefined;
  const sheetOpenRef = useRef(false);
  sheetOpenRef.current = sheet !== undefined;

  const [panel, setPanelState] = useState<Panel>(
    () => (panelRemembered.get(shapeId) ?? "design") as Panel,
  );
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
    const measure = () =>
      setArea({ w: element.clientWidth - 26, h: element.clientHeight - 26 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [facts === undefined]);
  const viewport = editorPreviewViewport(size);
  const scale = viewport === undefined ? 1 : previewScale(viewport, area);
  const grid = useRef<HTMLDivElement>(null);
  const [columnHeight, setColumnHeight] = useState(0);
  const [reveal, setReveal] = useState<{
    readonly element: string;
    readonly property: string;
    readonly nonce: number;
  }>();
  useLayoutEffect(() => {
    const element = grid.current;
    if (!element) return;
    const measure = () => {
      const padding = getComputedStyle(element);
      setColumnHeight(
        element.clientHeight -
          parseFloat(padding.paddingTop) -
          parseFloat(padding.paddingBottom),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [facts === undefined]);

  if (!facts) return null;
  const displayTitle = artifactTitle(facts);
  const title =
    displayTitle === "" ? shapeId.replace(/^shape:/, "") : displayTitle;
  const component = facts.kind === "component";
  const Icon =
    facts.kind === "page" ? AppWindow : component ? Component : Clapperboard;
  const shownPanel: Panel =
    component && panel === "parameters" ? "design" : panel;
  const askAboutComponent = () => {
    const chip: ChipElement = {
      elementId: null,
      liveSelector: facts.tag,
      tag: facts.tag,
      label: displayTitle || facts.tag,
      startTag: `<${facts.tag}>`,
      text: "",
      hasChildren: false,
    };
    tellAgent(chatClient, shapeId, [chip]);
  };
  const componentOf = (tag: string) => {
    const shape = editor
      .getCurrentPageShapes()
      .find(
        (candidate) =>
          candidate.type === "component" &&
          (candidate.props as { tag?: string }).tag === tag,
      );
    return shape === undefined
      ? undefined
      : {
          shapeId: shape.id,
          title: artifactTitle(
            shape.props as { title?: unknown; fileName?: unknown },
          ),
          file: (shape.props as { file?: string }).file,
        };
  };
  const goToMain = (id: string) => {
    void sessionRef.current.commit().then(() => onOpen(id));
  };
  const mode: EditMode = session.mode;
  const normalised =
    announcement === undefined
      ? undefined
      : normaliseDials(announcement.config);
  const current = normalised?.ok
    ? mergeDialValues(normalised.schema, dials ?? null)
    : dials;
  session.showDials(current ?? {});
  const names: Record<string, string> = {};
  for (const element of session.tree?.elements ?? [])
    names[element.id] = element.name;

  const timeline = facts.kind === "motion" && facts.file !== "";
  const columns = railFolded
    ? parametersFolded
      ? "grid-cols-[minmax(0,1fr)]"
      : "grid-cols-[minmax(0,1fr)_320px]"
    : "grid-cols-[360px_minmax(0,1fr)_320px]";
  const parametersBody = (
    <>
      <ColumnHeader>
        <Tabs
          value={shownPanel}
          onValueChange={(next) => setPanel(String(next) as Panel)}
          className="h-12 min-w-0"
        >
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
          onOpenKit={() =>
            kitUi(editor).update((state) => ({ ...state, open: true }))
          }
          onTell={(elements) => tellAgent(chatClient, shapeId, elements)}
          onAsk={(field, elements) =>
            tellAgent(
              chatClient,
              shapeId,
              elements,
              makeEditableInstruction(field),
            )
          }
          onShowOnTimeline={(element, property) =>
            setReveal({ element, property, nonce: (reveal?.nonce ?? 0) + 1 })
          }
          component={component ? session.declaration : null}
          componentTitle={component ? displayTitle || facts.tag : undefined}
          onAskComponent={askAboutComponent}
          componentOf={componentOf}
          onUpdateComponent={(tag) => void acceptUpdates([tag])}
          onGoToMain={goToMain}
          onMake={(element) =>
            void makeComponent({
              client: chatClient,
              statuses,
              shapeId: String(shapeId),
              kind: facts.kind,
              title: displayTitle,
              element,
            })
          }
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
          onWrite={(values) =>
            session.releaseDials(values as Record<string, unknown>)
          }
          post={(values) => post.current?.(values)}
        />
      )}
    </>
  );
  return (
    <div
      ref={grid}
      data-testid="artifact-editor"
      className={cn(
        "pointer-events-auto absolute inset-0 z-[700] box-border grid gap-3 bg-background p-3 font-sans text-foreground",
        timeline
          ? "grid-rows-[minmax(0,1fr)_auto]"
          : "grid-rows-[minmax(0,1fr)]",
        columns,
      )}
      {...KEEP_FROM_CANVAS}
    >
      {!railFolded && (
        <section
          data-editor-column="rail"
          className={cn(COLUMN, "col-start-1 row-span-full")}
        >
          <AgentRail
            project={project}
            embedded
            filterTo={[shapeId]}
            onOpenEditor={onOpen}
            onClose={close}
          />
        </section>
      )}
      <section
        data-editor-column="centre"
        className={cn(
          COLUMN,
          railFolded ? "col-start-1" : "col-start-2",
          "row-start-1",
        )}
        aria-label={`Editing ${title}`}
      >
        <ColumnHeader className="@container/editor-header gap-1">
          <Tip label="Back to canvas (Esc)">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label="Back to canvas"
              onClick={close}
            >
              <ArrowLeft aria-hidden />
            </Button>
          </Tip>
          {railFolded && (
            <Tip label="Show agent">
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                aria-label="Show agent"
                onClick={() => setSheet("agent")}
              >
                <PanelLeft aria-hidden />
                <span className="@max-[680px]/editor-header:sr-only">
                  Show agent
                </span>
              </Button>
            </Tip>
          )}
          <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <Tip label={title}>
              <span
                data-testid="artifact-editor-title"
                className="min-w-0 truncate text-sm font-semibold"
              >
                {title}
              </span>
            </Tip>
            <span
              data-testid="artifact-editor-kind"
              className="min-w-0 shrink truncate text-sm text-muted-foreground @max-[760px]/editor-header:hidden"
            >
              {facts.kind}
            </span>
            {component && uses > 0 && (
              <span
                data-testid="artifact-editor-uses"
                className="shrink-0 text-sm text-muted-foreground @max-[520px]/editor-header:hidden"
              >
                {uses === 1
                  ? "Used in 1 artifact"
                  : `Used in ${uses} artifacts`}
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
                if (picked === "edit" || picked === "interact")
                  session.setMode(picked);
              }}
            >
              <Tip label="Edit (V)">
                <Toggle value="edit" aria-label="Edit">
                  <MousePointer2 aria-hidden />
                  <span className="@max-[760px]/editor-header:sr-only">
                    Edit
                  </span>
                </Toggle>
              </Tip>
              <Tip label="Interact (I)">
                <Toggle value="interact" aria-label="Interact">
                  <Hand aria-hidden />
                  <span className="@max-[760px]/editor-header:sr-only">
                    Interact
                  </span>
                </Toggle>
              </Tip>
            </ToggleGroup>
          )}
          {facts.file !== "" && kit && (
            <KitModePicker shapeId={shapeId} variant="header" />
          )}
          <span role="status" className="sr-only">
            {updateNote}
          </span>
          {facts.file !== "" && updateRows.length > 0 && (
            <Popover open={updatesShown} onOpenChange={setUpdatesShown}>
              <PopoverTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    aria-label="Component updates available"
                  />
                }
              >
                <Component aria-hidden />
                <span className="@max-[520px]/editor-header:sr-only">
                  Component updates available
                </span>
              </PopoverTrigger>
              <PopoverPopup
                side="bottom"
                align="end"
                padding="compact"
                className="w-80"
                aria-label="Component updates"
                initialFocus={false}
              >
                <div className="flex flex-col gap-3">
                  <p
                    data-updates-title
                    tabIndex={-1}
                    className="m-0 text-sm font-semibold outline-none"
                  >
                    Component updates
                  </p>
                  {updateRows.map((row) => {
                    const uses =
                      session.tree?.elements.filter(
                        (element) => element.tag === row.tag,
                      ).length ?? 0;
                    return (
                      <div
                        key={row.tag}
                        className="flex flex-col gap-1"
                        data-update-row={row.tag}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 truncate text-sm font-medium">
                            {row.title}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {uses === 1 ? "1 instance" : `${uses} instances`}
                          </span>
                          <Button
                            variant="outline"
                            size="xs"
                            className="ml-auto shrink-0"
                            aria-label={`Update ${row.title}`}
                            data-update-tag={row.tag}
                            onClick={() => void acceptUpdates([row.tag])}
                          >
                            Update
                          </Button>
                        </div>
                        {row.warnings.map((warning) => (
                          <p
                            key={warning}
                            className="m-0 text-xs text-warning-foreground"
                          >
                            {warning}
                          </p>
                        ))}
                      </div>
                    );
                  })}
                  {updateRows.length >= 2 && (
                    <div className="border-t pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void acceptUpdates(updateRows.map((row) => row.tag))
                        }
                      >
                        Update all
                      </Button>
                    </div>
                  )}
                </div>
              </PopoverPopup>
            </Popover>
          )}
          {facts.file !== "" && (
            <PreviewSizeControl size={size} onChange={setSize} scale={scale} />
          )}
          {facts.kind === "motion" && facts.file !== "" && (
            <RenderButton shapeId={shapeId} />
          )}
          {facts.file !== "" && port !== undefined && (
            <Tip label="Open in a new tab">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                aria-label="Open in a new tab"
                onClick={() => {
                  window.open(
                    outsideUrlOf(
                      project,
                      shapeId,
                      facts.kind,
                      facts.file,
                      port,
                    ),
                    "_blank",
                    "noopener,noreferrer",
                  );
                  engine
                    .call("artifact.openLive", { project, shapeId })
                    .catch(() => undefined);
                }}
              >
                <ExternalLink aria-hidden />
              </Button>
            </Tip>
          )}
          {parametersFolded && (
            <Tip label="Show parameters">
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                aria-label="Show parameters"
                onClick={() => setSheet("parameters")}
              >
                <SlidersHorizontal aria-hidden />
                <span className="@max-[680px]/editor-header:sr-only">
                  Show parameters
                </span>
              </Button>
            </Tip>
          )}
        </ColumnHeader>
        <div
          ref={body}
          className={cn(
            "relative flex min-h-0 flex-1",
            viewport !== undefined &&
              "items-center justify-center overflow-hidden",
          )}
        >
          {facts.file === "" ? (
            <p className="m-auto p-6 text-center text-sm text-muted-foreground">{`This ${facts.kind} has no file yet. Ask the agent to write one.`}</p>
          ) : port === undefined ? null : (
            <div
              data-testid="artifact-preview"
              className={cn(
                viewport === undefined
                  ? "size-full"
                  : "box-content shrink-0 overflow-hidden border",
              )}
              style={
                viewport === undefined
                  ? undefined
                  : {
                      width: viewport.width * scale,
                      height: viewport.height * scale,
                    }
              }
            >
              <div
                className={cn(
                  "relative",
                  viewport === undefined && "size-full",
                )}
                style={
                  viewport === undefined
                    ? undefined
                    : {
                        width: viewport.width,
                        height: viewport.height,
                        transform: `scale(${scale})`,
                        transformOrigin: "0 0",
                      }
                }
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
                  <EditOverlay
                    hovered={session.hovered}
                    layerHover={session.layerHover}
                    selection={session.selection}
                    reports={session.reports}
                    boxes={session.boxes}
                    copies={session.copies}
                    names={names}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </section>
      {!parametersFolded && (
        <section
          data-editor-column="parameters"
          className={cn(
            COLUMN,
            railFolded ? "col-start-2" : "col-start-3",
            "row-span-full pb-10 max-[1279px]:row-span-1 max-[1279px]:row-start-1",
          )}
        >
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
          onAsk={(field, elements) =>
            tellAgent(
              chatClient,
              shapeId,
              elements,
              makeEditableInstruction(field),
            )
          }
          kit={kit}
          mode={facts.mode}
          reveal={reveal}
          className={
            railFolded
              ? parametersFolded
                ? "col-start-1 row-start-2"
                : "col-start-1 col-span-2 row-start-2"
              : "col-start-2 row-start-2 max-[1279px]:col-span-2"
          }
        />
      )}
      <Sheet
        open={sheet === "agent"}
        onOpenChange={(open) => setSheet(open ? "agent" : undefined)}
      >
        <SheetPopup
          side="left"
          aria-label="Agent"
          showCloseButton={false}
          className="w-[min(88vw,24rem)]"
        >
          <AgentRail
            project={project}
            inSheet
            filterTo={[shapeId]}
            onOpenEditor={onOpen}
            onClose={() => setSheet(undefined)}
          />
        </SheetPopup>
      </Sheet>
      <Sheet
        open={sheet === "parameters"}
        onOpenChange={(open) => setSheet(open ? "parameters" : undefined)}
      >
        <SheetPopup
          side="right"
          aria-label="Parameters"
          showCloseButton={false}
          className="w-[min(88vw,24rem)]"
        >
          <div className="flex min-h-0 flex-1 flex-col">{parametersBody}</div>
        </SheetPopup>
      </Sheet>
    </div>
  );
};
