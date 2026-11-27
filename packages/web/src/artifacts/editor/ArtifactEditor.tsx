import type { ArtifactShapeProps, ComponentUpdate, ScreenShapeProps } from "@unframed/contracts";
import {
  artifactTitle,
  NO_BRIDGE,
  SCREEN_EDIT_NOTE,
  SCREEN_VIEWPORTS,
  screenChip,
  screenLabel,
  elementLabel,
  dialsWith,
  editorPreviewViewport,
  FEATURE_OFF_MESSAGES,
  isArtifactKind,
  mergeDialValues,
  normaliseDials,
  previewScale,
  type ArtifactKind,
  type ChipElement,
  type DialsAnnouncement,
  type EditorKind,
} from "@unframed/domain";
import {
  Component,
  ExternalLink,
  Hand,
  MousePointer2,
  PanelLeft,
  RotateCw,
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
import { useValue } from "tldraw";
import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Sheet, SheetPopup } from "~/components/ui/sheet";
import { Tabs, TabsList, TabsTab } from "~/components/ui/tabs";
import { TOP_BAR_HEIGHT } from "~/components/ui/top-bar";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";
import { AgentRail } from "../../agent/rail/AgentRail.tsx";
import { useChatClient, useProviders } from "../../agent/store.ts";
import { Tip } from "../../chrome/ui.tsx";
import { useCanvasDoc } from "../../canvas/doc.ts";
import { useCanvasProject, useEngine } from "../../context.ts";
import { useFeature } from "../../features.ts";
import {
  ArtifactFrame,
  outsideUrlOf,
  type EditMessage,
} from "../ArtifactFrame.tsx";
import { kitUi } from "../../kits/state.ts";
import { KitModePicker } from "../KitMode.tsx";
import { countUsing } from "../componentPins.ts";
import { updateTagsOf } from "../updates.ts";
import { makeComponent } from "./makeComponent.ts";
import { KIND_LOOK } from "../kinds.ts";
import { artifactsOf, previewPort } from "../state.ts";
import { RenderButton } from "../render.tsx";
import { ComponentSection } from "./ComponentSection.tsx";
import { EditOverlay } from "./EditOverlay.tsx";
import { DesignTab } from "./DesignTab.tsx";
import { LayersTab } from "./LayersTab.tsx";
import { COLUMN, ColumnHeader, ParametersContent } from "./Parameters.tsx";
import { PreviewSizeControl, usePreviewSize } from "./PreviewSize.tsx";
import { useEditSession, type EditMode } from "./editSession.ts";
import { chipDataFor } from "./chipData.ts";
import { makeEditableInstruction, tellAgent } from "./tellAgent.ts";
import { screenInstructions } from "../ParametersPanel.tsx";
import { BranchChip } from "../../repositories/BranchChip.tsx";
import { installEditorDemand } from "../../repositories/demand.ts";
import { OpenInBrowser } from "../../repositories/ScreenActions.tsx";
import { ScreenPreview } from "../../repositories/ScreenPreview.tsx";
import { ScreenDrafts } from "../../repositories/ScreenDrafts.tsx";
import { useScreenApply } from "../../repositories/screenApply.ts";
import { repositoryState } from "../../repositories/store.ts";
import { MotionTimeline } from "../timeline/MotionTimeline.tsx";
import { MotionTransport, type TransportZone } from "../timeline/transport.ts";
import { kitOf } from "../../kits/kitRoom.ts";

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

interface ArtifactEditorProps {
  readonly shapeId: string;
  readonly onClose: () => void;
  readonly onOpen: (shapeId: string) => void;
  readonly onLeave?: (commit: () => Promise<void>) => () => void;
}

type Panel = "design" | "layers" | "parameters";

const panelRemembered = new Map<string, Panel>();

const typingIn = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, [contenteditable='true']") !== null);

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
  if (active.hasAttribute("data-timeline-focus")) return "strip";
  if (
    active.closest("[data-testid='timeline-transport']") !== null &&
    active.matches("button:not([aria-haspopup])")
  )
    return "strip";
  return undefined;
};

const isUndo = (event: KeyboardEvent): boolean =>
  (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z";

const UPDATE_RETRIES = 8;
const UPDATE_RETRY_MS = 250;

export const ArtifactEditor = ({
  shapeId,
  onClose,
  onOpen,
  onLeave,
}: ArtifactEditorProps) => {
  const doc = useCanvasDoc();
  const project = useCanvasProject();
  const engine = useEngine();
  const projectKit = useValue("project kit", () => kitOf(doc), [doc]);
  const chatClient = useChatClient(engine, project);
  const { statuses } = useProviders(chatClient);
  const repositories = useFeature("repositories");
  const facts = useValue(
    "edited artifact",
    () => {
      const shape = doc.shape(shapeId);
      if (shape?.type === "screen") {
        if (!repositories) return undefined;
        const props = shape.props as ScreenShapeProps;
        return { kind: "screen" as EditorKind, file: "", title: props.title, fileName: undefined, dials: props.dials, mode: props.mode, locked: [] as string[], tag: "", screen: props };
      }
      if (!shape || !isArtifactKind(shape.type)) return undefined;
      const props = shape.props as ArtifactShapeProps;
      return {
        kind: shape.type as EditorKind,
        file: props.file,
        title: props.title,
        fileName: props.fileName,
        dials: props.dials,
        mode: props.mode,
        locked: props.lockedElements ?? [],
        tag: (props as { tag?: string }).tag ?? "",
        screen: undefined,
      };
    },
    [doc, shapeId, repositories],
  );
  const screen = facts?.screen;
  const isScreen = screen !== undefined;
  const kit = isScreen ? null : projectKit;
  const instance = useValue("screen instance", () => (screen === undefined ? undefined : repositoryState(project).instances.get().get(screen.instance)), [project, screen?.instance]);
  const screenBridge = useValue("screen bridge", () => repositoryState(project).bridges.get().get(shapeId), [project, shapeId]);
  const heard = useValue("screen announcement", () => artifactsOf(doc).heard.get().get(shapeId), [doc, shapeId]);
  useEffect(() => (isScreen ? installEditorDemand(engine, project, () => (doc.shape(shapeId)?.props as { instance?: string } | undefined)?.instance) : undefined), [isScreen, engine, project, doc, shapeId]);
  const uses = useValue(
    "component uses",
    () => {
      if (facts?.kind !== "component") return 0;
      const files = doc
        .pageShapes()
        .filter((shape) => shape.type === "page" || shape.type === "motion")
        .map((shape) => (shape.props as { file?: string }).file ?? "");
      return countUsing(project, facts.tag, files);
    },
    [doc, project, facts?.kind, facts?.tag],
  );
  const port = useValue("preview port", () => previewPort.get(), []);
  const gone = facts === undefined;
  const editing = useFeature("element-editing");

  const session = useEditSession({
    doc,
    engine,
    project,
    shapeId,
    kind: facts?.kind ?? "page",
    file: facts?.file ?? "",
    locked: facts?.locked ?? [],
    kit,
    editing,
    target: isScreen ? "screen" : "file",
    onUndoEmpty: () => void screenApplyRef.current.undo(),
  });
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const screenApply = useScreenApply({
    engine,
    project,
    shapeId,
    instance: instance === undefined ? undefined : { id: instance.id, branch: instance.branch, worktree: instance.worktree },
    state: screen === undefined ? "" : screen.state?.trim() || screen.route,
    session,
    client: chatClient,
  });
  const screenApplyRef = useRef(screenApply);
  screenApplyRef.current = screenApply;
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
    () => updateTagsOf(doc.pageShapes(), project, facts?.file ?? "").join(","),
    [doc, project, facts?.file],
  );
  const [updateRows, setUpdateRows] = useState<ReadonlyArray<ComponentUpdate>>(
    [],
  );
  const [updatesShown, setUpdatesShown] = useState(false);
  const [reloads, setReloads] = useState(0);
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
    () => artifactsOf(doc).updatesOpen.get() === shapeId,
    [doc, shapeId],
  );
  useEffect(() => {
    if (!badgeRequested) return;
    setUpdatesShown(true);
    artifactsOf(doc).updatesOpen.set(undefined);
  }, [badgeRequested, doc]);
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
          doc.shape(shapeId)?.props as
            { lockedElements?: string[] } | undefined
        )?.lockedElements ?? [];
      const next = on
        ? [...current.filter((other) => other !== id), id]
        : current.filter((other) => other !== id);
      doc.update(shapeId, { lockedElements: next.length === 0 ? undefined : next }, "lock");
      sessionRef.current.setLocked(next);
    },
    [doc, shapeId],
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

  const leaveRef = useRef(onLeave);
  useEffect(
    () =>
      leaveRef.current?.(() => {
        if (doc.shape(shapeId)) return sessionRef.current.commit();
        sessionRef.current.discard(true);
        return Promise.resolve();
      }),
    [doc, shapeId],
  );

  useEffect(() => {
    const onUndo = (event: KeyboardEvent) => {
      if ((event.key === "Backspace" || event.key === "Delete") && !typingIn(event.target) && !typingIn(document.activeElement) && sessionRef.current.handleKey(event.key, { shift: event.shiftKey, meta: event.metaKey, ctrl: event.ctrlKey })) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
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
  }, [transport]);

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
    () => (panelRemembered.get(shapeId) ?? (editing ? "design" : "parameters")) as Panel,
  );
  const setPanel = (next: Panel) => {
    panelRemembered.set(shapeId, next);
    setPanelState(next);
  };

  const [pageSize, setPageSize] = usePreviewSize(project, shapeId);
  const size = screen === undefined ? pageSize : { choice: "custom" as const, custom: { width: Math.round(screen.w), height: Math.round(screen.h) } };
  const setSize = screen === undefined ? setPageSize : (next: typeof pageSize) => {
    const chosen = editorPreviewViewport(next);
    if (chosen !== undefined) doc.update(shapeId, { w: chosen.width, h: chosen.height }, "screen viewport");
  };
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
  const hasFile = facts.file !== "";
  const previewable = hasFile || isScreen;
  const forAgent = (elements: ChipElement[]) =>
    isScreen ? elements.map((element) => screenChip(element, session.reports[element.elementId ?? ""] ?? {})) : elements;
  const tell = (elements: ChipElement[]) => tellAgent(chatClient, shapeId, forAgent(elements));
  const ask = (field: string, elements: ChipElement[]) => tellAgent(chatClient, shapeId, forAgent(elements), makeEditableInstruction(field));
  const displayTitle = screen === undefined ? artifactTitle(facts) : screenLabel({ branch: screen.title, route: screen.route, state: screen.state });
  const title =
    displayTitle === "" ? shapeId.replace(/^shape:/, "") : displayTitle;
  const component = facts.kind === "component";
  const Icon = KIND_LOOK[facts.kind].Icon;
  const shownPanel: Panel | undefined = !editing
    ? component
      ? undefined
      : "parameters"
    : component && panel === "parameters"
      ? "design"
      : panel;
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
    const shape = doc
      .pageShapes()
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
  const shownAnnouncement = isScreen ? heard : announcement;
  const normalised =
    shownAnnouncement === undefined
      ? undefined
      : normaliseDials(shownAnnouncement.config);
  const current = normalised?.ok
    ? mergeDialValues(normalised.schema, dials ?? null)
    : dials;
  session.showDials(current ?? {});
  const names: Record<string, string> = {};
  for (const element of session.tree?.elements ?? [])
    names[element.id] = element.name;
  if (isScreen)
    for (const id of session.selection) {
      const report = session.reports[id];
      if (report === undefined) continue;
      const owner = session.resolved[id]?.owner ?? report.owner ?? null;
      names[id] = elementLabel({ tag: report.tag, owner, w: report.box.w, h: report.box.h });
    }

  const timeline = facts.kind === "motion" && hasFile && editing;
  const columns = railFolded
    ? parametersFolded
      ? "grid-cols-[minmax(0,1fr)]"
      : "grid-cols-[minmax(0,1fr)_var(--artifact-editor-parameters-width)]"
    : "grid-cols-[var(--artifact-editor-rail-width)_minmax(0,1fr)_var(--artifact-editor-parameters-width)]";
  const parametersBody = (
    <>
      {editing ? (
        <ColumnHeader className="px-0">
          <Tabs value={shownPanel} onValueChange={(next) => setPanel(String(next) as Panel)} className="h-full min-w-0">
            <TabsList variant="underline" fill aria-label="Editor panels">
              {editing && <TabsTab value="design">Design</TabsTab>}
              {editing && <TabsTab value="layers">Layers</TabsTab>}
              {!component && (
                <TabsTab value="parameters">
                  <SlidersHorizontal aria-hidden />
                  Parameters
                </TabsTab>
              )}
            </TabsList>
          </Tabs>
        </ColumnHeader>
      ) : (
        <ColumnHeader className="gap-1 pl-3.5">
          <SlidersHorizontal aria-hidden className="size-4 shrink-0 text-(--artifact-editor-icon)" />
          <h2 className="m-0 ml-1 flex-1 text-sm font-medium">Parameters</h2>
        </ColumnHeader>
      )}
      {isScreen && (shownPanel === "design" || shownPanel === "layers") && (
        <p className="m-0 px-2.5 pt-2.5 text-xs text-(--artifact-editor-note)" data-testid="screen-edit-note">
          {SCREEN_EDIT_NOTE}
        </p>
      )}
      {shownPanel === "design" && (
        <DesignTab
          screen={isScreen ? { engine, project, instance: instance?.id } : undefined}
          session={session}
          kind={facts.kind}
          images={!isScreen}
          project={project}
          dials={current ?? {}}
          locked={facts.locked}
          kit={kit}
          mode={facts.mode}
          onOpenKit={() => kitUi(doc).update((state) => ({ ...state, open: true }))}
          onTell={tell}
          onAsk={ask}
          onShowOnTimeline={(element, property) =>
            setReveal({ element, property, nonce: (reveal?.nonce ?? 0) + 1 })
          }
          component={component ? session.declaration : null}
          componentTitle={component ? displayTitle || facts.tag : undefined}
          onAskComponent={askAboutComponent}
          componentOf={componentOf}
          onUpdateComponent={(tag) => void acceptUpdates([tag])}
          onGoToMain={goToMain}
          onMake={isScreen ? undefined : (element) =>
            void makeComponent({
              client: chatClient,
              statuses,
              shapeId: String(shapeId),
              kind: facts.kind as ArtifactKind,
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
          onLock={isScreen ? undefined : setLocked}
          renamable={!isScreen}
          onTell={tell}
        />
      )}
      {shownPanel === undefined && (
        <p className="m-0 p-3 text-sm text-(--artifact-editor-note)" data-testid="editor-no-panels">
          {FEATURE_OFF_MESSAGES["element-editing"]}
        </p>
      )}
      {shownPanel === "parameters" && (
        <div className="min-h-0 flex-1 overflow-auto">
          {screen === undefined ? (
            <ParametersContent
              shapeId={shapeId}
              kind={facts.kind as ArtifactKind}
              title={title}
              announcement={announcement}
              saved={dials}
              onWrite={(values) =>
                session.releaseDials(values as Record<string, unknown>)
              }
              post={(values) => post.current?.(values)}
              place="editor"
              railVisible={!railFolded || sheet === "agent"}
            />
          ) : (
            <ParametersContent
              shapeId={shapeId}
              kind="page"
              title={title}
              announcement={heard}
              saved={screen.dials}
              post={(values) => artifactsOf(doc).posts.get(shapeId)?.(values)}
              place="editor"
              railVisible={!railFolded || sheet === "agent"}
              notice={screenBridge === false ? NO_BRIDGE : undefined}
              instructions={screenInstructions(instance === undefined ? undefined : { route: screen.route, branch: instance.branch, worktree: instance.worktree })}
            />
          )}
        </div>
      )}
    </>
  );
  const editOverlay = session.mode === "edit" && (
    <EditOverlay
      hovered={session.hovered}
      layerHover={session.layerHover}
      selection={session.selection}
      reports={session.reports}
      boxes={session.boxes}
      copies={session.copies}
      names={names}
      tagged={!isScreen}
    />
  );
  return (
    <div
      ref={grid}
      data-testid="artifact-editor"
      className={cn(
        "pointer-events-auto absolute inset-x-0 bottom-0 z-[700] box-border grid bg-(--artifact-editor-surface) font-sans text-(--artifact-editor-foreground)",
        timeline
          ? "grid-rows-[minmax(0,1fr)_auto]"
          : "grid-rows-[minmax(0,1fr)]",
        columns,
      )}
      style={{ top: TOP_BAR_HEIGHT }}
    >
      {!railFolded && (
        <section
          data-editor-column="rail"
          className={cn(COLUMN, "col-start-1 row-span-full border-r [&_header:has(>h2)]:border-b")}
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
          !parametersFolded && "border-r",
        )}
        aria-label={`Editing ${title}`}
      >
        <ColumnHeader className="@container/editor-header gap-1">
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
          <Icon aria-hidden className="size-4 shrink-0 text-(--artifact-editor-icon) @max-[520px]/editor-header:hidden" />
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
              className="min-w-0 shrink truncate text-sm text-(--artifact-editor-meta) @max-[760px]/editor-header:hidden"
            >
              {facts.kind}
            </span>
            {component && uses > 0 && (
              <span
                data-testid="artifact-editor-uses"
                className="shrink-0 text-sm text-(--artifact-editor-meta) @max-[520px]/editor-header:hidden"
              >
                {uses === 1
                  ? "Used in 1 artifact"
                  : `Used in ${uses} artifacts`}
              </span>
            )}
          </span>
          {isScreen && <ScreenDrafts session={session} run={screenApply.run} onApply={() => void screenApply.apply()} onDismiss={screenApply.clear} />}
          {isScreen && <BranchChip owner={doc} shapeId={shapeId} />}
          {previewable && editing && (
            <ToggleGroup
              aria-label="Mode"
              variant="default"
              size="xs"
              className="shrink-0"
              value={[session.mode]}
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
          {hasFile && kit && (
            <KitModePicker shapeId={shapeId} variant="header" />
          )}
          <span role="status" className="sr-only">
            {updateNote}
          </span>
          {hasFile && updateRows.length > 0 && (
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
                          <span className="shrink-0 text-xs text-(--artifact-editor-meta)">
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
                            className="m-0 text-xs text-(--artifact-editor-warning-foreground)"
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
          {previewable && (
            <PreviewSizeControl size={size} onChange={setSize} scale={scale} presets={isScreen ? SCREEN_VIEWPORTS : undefined} />
          )}
          {isScreen && <OpenInBrowser owner={doc} shapeId={shapeId} size="icon" />}
          {facts.kind === "motion" && hasFile && (
            <RenderButton shapeId={shapeId} />
          )}
          {hasFile && port !== undefined && (
            <Tip label="Reload">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                aria-label="Reload"
                data-testid="artifact-editor-reload"
                onClick={() => setReloads((count) => count + 1)}
              >
                <RotateCw aria-hidden />
              </Button>
            </Tip>
          )}
          {hasFile && port !== undefined && (
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
                      facts.kind as ArtifactKind,
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
          {facts.file === "" && !isScreen ? (
            <p className="m-auto p-6 text-center text-sm text-(--artifact-editor-note)">{`This ${facts.kind} has no file yet. Ask the agent to write one.`}</p>
          ) : port === undefined && !isScreen ? null : (
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
                {screen !== undefined ? (
                  <ScreenPreview shapeId={shapeId} props={screen} edit={{ onEdit, onEditReady }} overlay={editOverlay} />
                ) : port !== undefined && (
                <ArtifactFrame
                  key={reloads}
                  project={project}
                  kind={facts.kind as ArtifactKind}
                  file={facts.file}
                  previewPort={port}
                  dials={dials}
                  kit={kit}
                  mode={facts.mode}
                  interactive
                  lazy={false}
                  onAnnounce={setAnnouncement}
                  onReady={onReady}
                  editable={editing}
                  onEdit={onEdit}
                  onEditReady={onEditReady}
                  onSwapped={clearAnnouncement}
                  onPlayer={transport.onPlayerMessage}
                  onPlayerReady={onPlayerReady}
                />
                )}
                {screen === undefined && editOverlay}
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
          onAsk={ask}
          kit={kit}
          mode={facts.mode}
          reveal={reveal}
          className={
            railFolded
              ? parametersFolded
                ? "col-start-1 row-start-2"
                : "col-start-1 col-span-2 row-start-2"
              : "col-start-2 row-start-2 border-r max-[1279px]:col-span-2 max-[1279px]:border-r-0"
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
          className="w-[min(88vw,var(--artifact-editor-sheet-width))]"
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
          className="w-[min(88vw,var(--artifact-editor-sheet-width))]"
        >
          <div className="flex min-h-0 flex-1 flex-col">{parametersBody}</div>
        </SheetPopup>
      </Sheet>
    </div>
  );
};
