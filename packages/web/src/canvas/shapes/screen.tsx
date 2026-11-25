import type { ScreenMock, ScreenShapeProps, ScreenStep } from "@unframed/contracts";
import { describeStep, fixStateInstruction, followNavigation, NO_STATE_BRIDGE, screenLabel, screenOverlay, screenUrl, setupTag, stateRoute, type DialsAnnouncement, type SetupChatState } from "@unframed/domain";
import { useEffect, useRef, useState } from "react";
import { BaseBoxShapeUtil, HTMLContainer, resizeBox, T, useEditor, useValue, type RecordProps, type TLResizeInfo, type TLShape } from "tldraw";
import { TriangleAlert } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { forgetFrame, hearFrame, isInteractive, reachFrame } from "../../artifacts/state.ts";
import { useChatClient, useChats } from "../../agent/store.ts";
import { useCanvasProject, useEngine } from "../../context.ts";
import { isDeviceClient } from "../../deviceMode.ts";
import { Tip } from "../../chrome/ui.tsx";
import { useFeature } from "../../features.ts";
import { noteRender } from "../../fps/renders.ts";
import { screenOnScreen } from "../../repositories/demand.ts";
import { noteBridge, repositoryState, screenSnapshotUrl, useRepositorySetup } from "../../repositories/store.ts";
import { useAskAgent } from "../../repositories/askAgent.ts";
import { artifactCardClass } from "./looks.ts";
import { ShapeLabel } from "./ShapeLabel.tsx";

type ScreenShape = TLShape<"screen">;

const SCREEN_MIN = { w: 240, h: 160 };

const screenProps: RecordProps<ScreenShape> = {
  w: T.nonZeroNumber,
  h: T.nonZeroNumber,
  instance: T.string,
  route: T.string,
  title: T.string,
  dials: T.dict(T.string, T.jsonValue).optional(),
  mode: T.string.optional(),
  steps: T.arrayOf(T.jsonValue).optional() as T.Validatable<ScreenStep[] | undefined>,
  mocks: T.arrayOf(T.jsonValue).optional() as T.Validatable<ScreenMock[] | undefined>,
  state: T.string.optional(),
};

export const SCREEN_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-modals";

const NO_STATE_KEY = "[[],[]]";
const RELOAD_GRACE_MS = 2000;

const nonEmpty = (dials: Readonly<Record<string, unknown>> | undefined) => dials !== undefined && Object.keys(dials).length > 0;

interface StepsResult {
  readonly ok: boolean;
  readonly step?: number;
  readonly reason?: string;
}

interface FrameEvents {
  readonly onPainted: () => void;
  readonly onBridge: (bridge: boolean) => void;
  readonly onReady: (route: string | undefined, state: boolean) => void;
  readonly onRoute: (route: string, replaying: boolean) => void;
  readonly onSteps: (result: StepsResult) => void;
}

const LiveScreen = ({ shapeId, url, dials, interactive, events }: {
  readonly shapeId: string;
  readonly url: string;
  readonly dials: Readonly<Record<string, unknown>> | undefined;
  readonly interactive: boolean;
  readonly events: FrameEvents;
}) => {
  const editor = useEditor();
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const saved = useRef(dials);
  saved.current = dials;
  const handlers = useRef(events);
  handlers.current = events;
  const target = new URL(url).origin;
  const post = (message: unknown) => {
    try {
      frame.current?.contentWindow?.postMessage(message, target);
    } catch {
      return;
    }
  };
  useEffect(() => {
    reachFrame(editor, shapeId, (values) => post({ type: "unframed:dials:set", values }));
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: unknown; route?: unknown; state?: unknown; replaying?: unknown; ok?: unknown; step?: unknown; reason?: unknown } | null;
      if (typeof data !== "object" || data === null) return;
      if (data.type === "unframed:screen:ready") {
        ready.current = true;
        handlers.current.onBridge(true);
        handlers.current.onReady(typeof data.route === "string" ? data.route : undefined, data.state === true);
        post({ type: "unframed:dials:hello" });
      } else if (data.type === "unframed:screen:paint") handlers.current.onPainted();
      else if (data.type === "unframed:screen:route" && typeof data.route === "string") handlers.current.onRoute(data.route, data.replaying === true);
      else if (data.type === "unframed:screen:steps")
        handlers.current.onSteps({ ok: data.ok === true, ...(typeof data.step === "number" ? { step: data.step } : {}), ...(typeof data.reason === "string" ? { reason: data.reason } : {}) });
      else if (data.type === "unframed:dials") {
        if (nonEmpty(saved.current)) post({ type: "unframed:dials:set", values: saved.current });
        hearFrame(editor, shapeId, data as DialsAnnouncement);
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      forgetFrame(editor, shapeId);
    };
  }, [editor, shapeId, target]);
  const serialised = JSON.stringify(dials ?? null);
  useEffect(() => {
    if (nonEmpty(dials)) post({ type: "unframed:dials:set", values: dials });
  }, [serialised]);
  return (
    <iframe
      ref={frame}
      className="absolute inset-0 block size-full border-0 bg-(--canvas-artifact-page)"
      data-screen-frame=""
      title="Screen"
      src={url}
      sandbox={SCREEN_SANDBOX}
      referrerPolicy="no-referrer"
      allow=""
      data-interactive={interactive ? "true" : undefined}
      style={{ pointerEvents: interactive ? "auto" : "none" }}
      onLoad={() => {
        if (ready.current) post({ type: "unframed:dials:hello" });
        else {
          handlers.current.onBridge(false);
          handlers.current.onPainted();
        }
      }}
    />
  );
};

const useSetupChat = (project: string): SetupChatState | undefined => {
  const client = useChatClient(useEngine(), project);
  const chats = useChats(client);
  const id = useValue("setup chat", () => repositoryState(project).repository.get()?.setupChat ?? null, [project]);
  const chat = id === null ? undefined : chats.find((summary) => summary.id === id);
  if (chat === undefined) return undefined;
  if (chat.hasPendingUserInput || chat.hasPendingApproval) return "asking";
  return chat.status === "running" ? "running" : "idle";
};

const Overlay = ({ project, instance }: { readonly project: string; readonly instance: string }) => {
  const state = repositoryState(project);
  const setupChat = useSetupChat(project);
  const overlay = useValue(
    "screen overlay",
    () => screenOverlay({ instance: state.instances.get().get(instance), loaded: state.loaded.get(), repository: state.repository.get()?.status, setupChat }),
    [state, instance, setupChat],
  );
  if (overlay.kind === "none") return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-(--artifact-card-surface) p-6 text-center font-sans text-sm text-(--artifact-card-foreground)"
      data-testid="screen-overlay"
      data-overlay={overlay.kind}
    >
      {overlay.kind === "progress" && <Spinner size="lg" tone="muted" />}
      <span className="font-medium text-(--artifact-card-title)">{overlay.kind === "failed" ? overlay.message : overlay.label}</span>
      {(overlay.kind === "progress" || overlay.kind === "waiting") && overlay.detail !== undefined && <span data-testid="screen-overlay-detail">{overlay.detail}</span>}
      {overlay.kind === "failed" && overlay.log !== "" && (
        <pre className="max-w-full overflow-hidden text-start font-mono text-xs whitespace-pre-wrap" data-testid="screen-log">
          {overlay.log}
        </pre>
      )}
    </div>
  );
};

const SetupBadges = ({ project, note }: { readonly project: string; readonly note: string | undefined }) => {
  const setup = useRepositorySetup(project);
  const tag = setupTag(setup);
  const warnings = setup?.warnings ?? [];
  if (tag === undefined && warnings.length === 0 && note === undefined) return null;
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1" data-testid="screen-setup-badges">
      {note !== undefined && (
        <Badge size="sm" variant="warning" className="min-w-0 shrink" data-testid="screen-state-note">
          <span className="truncate">{note}</span>
        </Badge>
      )}
      {tag !== undefined && (
        <Tip label={`Mocked by Setup: ${tag}`}>
          <Badge size="sm" variant="secondary" className="pointer-events-auto min-w-0 shrink" data-testid="screen-mock-tag">
            <span className="truncate">{tag}</span>
          </Badge>
        </Tip>
      )}
      {warnings.length > 0 && (
        <Tip
          label={
            <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="screen-warnings">
              {warnings.map((warning) => (
                <li key={warning} data-testid="screen-warning">
                  {warning}
                </li>
              ))}
            </ul>
          }
        >
          <Button variant="warning-outline" size="micro" className="pointer-events-auto" data-testid="screen-warnings-badge" aria-label={warnings.length === 1 ? "1 Setup warning" : `${warnings.length} Setup warnings`}>
            <TriangleAlert aria-hidden />
            {warnings.length}
          </Button>
        </Tip>
      )}
    </div>
  );
};

const ScreenCard = ({ shape }: { readonly shape: ScreenShape }) => {
  noteRender(shape.id);
  const editor = useEditor();
  const project = useCanvasProject();
  const repositories = useFeature("repositories");
  const props = shape.props as ScreenShapeProps;
  const state = repositoryState(project);
  const snapshot = useValue("screen snapshot", () => state.snapshots.get().get(shape.id), [state, shape.id]);
  const proxyPort = useValue(
    "screen proxy",
    () => {
      const instance = state.instances.get().get(props.instance);
      return instance?.state === "live" ? instance.proxyPort : null;
    },
    [state, props.instance],
  );
  const branch = useValue("screen branch", () => state.instances.get().get(props.instance)?.branch ?? props.title, [state, props.instance, props.title]);
  const label = screenLabel({ branch, route: props.route, state: props.state });
  const onScreen = useValue("screen on screen", () => screenOnScreen(editor, shape.id), [editor, shape.id]);
  const interactive = useValue("screen interactive", () => isInteractive(editor, shape.id), [editor, shape.id]);
  const live = repositories && !isDeviceClient() && onScreen && proxyPort !== null;
  const engine = useEngine();
  const ask = useAskAgent();
  const stateKey = JSON.stringify([props.steps ?? [], props.mocks ?? []]);
  const holdsState = stateKey !== NO_STATE_KEY;
  const shown = useRef<{ readonly route: string; readonly stateKey: string; readonly port: number; readonly reloads: number } | undefined>(undefined);
  const loads = useRef(0);
  const [load, setLoad] = useState<{ readonly url: string; readonly n: number; readonly token: boolean; readonly at: number } | undefined>(undefined);
  const [reloads, setReloads] = useState(0);
  const [failure, setFailure] = useState<{ readonly step: number; readonly reason: string } | undefined>(undefined);
  const [asking, setAsking] = useState<string | undefined>(undefined);
  const bridge = useValue("screen bridge", () => state.bridges.get().get(shape.id), [state, shape.id]);
  useEffect(() => {
    if (!live || proxyPort === null) {
      shown.current = undefined;
      return;
    }
    const want = { route: props.route, stateKey, port: proxyPort, reloads };
    const now = shown.current;
    if (now !== undefined && now.route === want.route && now.stateKey === want.stateKey && now.port === want.port && now.reloads === want.reloads) return;
    shown.current = want;
    const seq = ++loads.current;
    const begin = (token: string | null) => {
      if (seq !== loads.current) return;
      setFailure(undefined);
      setLoad({ url: screenUrl(proxyPort, token === null ? props.route : stateRoute(props.route, token)), n: seq, token: token !== null, at: Date.now() });
    };
    if (!holdsState) begin(null);
    else engine.call("screens.stateToken", { project, instance: props.instance, steps: props.steps ?? [], mocks: props.mocks ?? [] }).then(({ token }) => begin(token), () => begin(null));
  }, [live, proxyPort, props.route, stateKey, reloads]);
  const follow = (route: string) => {
    if (!editor.getSelectedShapeIds().includes(shape.id)) return;
    const current = editor.getShape(shape.id);
    if (current?.type !== "screen") return;
    const next = followNavigation(current.props as ScreenShapeProps, route);
    if (next === undefined || shown.current === undefined) return;
    shown.current = { ...shown.current, route: next.route, stateKey: NO_STATE_KEY };
    setFailure(undefined);
    editor.markHistoryStoppingPoint("screen navigation");
    editor.store.put([{ ...current, props: next } as TLShape]);
  };
  const events: FrameEvents = {
    onPainted: () => setPainted(load?.url),
    onBridge: (bridged) => noteBridge(project, shape.id, bridged),
    onReady: (route, applied) => {
      if (holdsState && load?.token === true && !applied && Date.now() - load.at > RELOAD_GRACE_MS) setReloads((count) => count + 1);
      else if (route !== undefined && !applied) follow(route);
    },
    onRoute: (route, replaying) => {
      if (!replaying) follow(route);
    },
    onSteps: (result) => setFailure(result.ok ? undefined : { step: result.step ?? 0, reason: result.reason ?? "" }),
  };
  const fix = () => {
    const step = failure === undefined ? undefined : props.steps?.[failure.step];
    if (failure === undefined || step === undefined) return;
    const instruction = fixStateInstruction({
      shape: shape.id.replace(/^shape:/, ""),
      branch,
      state: props.state?.trim() || props.route,
      route: props.route,
      steps: props.steps,
      mocks: props.mocks,
      number: failure.step + 1,
      step: describeStep(step),
      reason: failure.reason,
    });
    setAsking(undefined);
    ask(shape.id, instruction).then(
      () => setAsking("Sent to the agent."),
      (error: unknown) => setAsking(error instanceof Error ? error.message : String(error)),
    );
  };
  const url = live ? load?.url : undefined;
  const [painted, setPainted] = useState<string | undefined>(undefined);
  const shownPainted = live && url !== undefined && painted === url;
  const failedStep = failure === undefined ? undefined : props.steps?.[failure.step];
  return (
    <HTMLContainer
      id={shape.id}
      className={`${artifactCardClass} overflow-hidden`}
      data-testid="screen"
      data-route={props.route}
      data-state={props.state?.trim() ? props.state : undefined}
      data-live={live ? "true" : undefined}
      data-painted={shownPainted ? "true" : undefined}
      style={{ width: props.w, height: props.h }}
    >
      <ShapeLabel shapeId={shape.id} kind="screen" width={props.w} text={label} />
      {live && url !== undefined && <LiveScreen key={load?.n} shapeId={shape.id} url={url} dials={props.dials} interactive={interactive} events={events} />}
      {!shownPainted &&
        (snapshot !== undefined ? (
          <img className="pointer-events-none absolute inset-0 block size-full object-cover select-none" data-testid="screen-snapshot" src={screenSnapshotUrl(project, snapshot)} alt="" draggable={false} />
        ) : (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-(--artifact-card-surface) p-3 text-center font-sans text-sm text-(--artifact-card-foreground)">
            <span className="font-medium text-(--artifact-card-title)">{branch}</span>
            <span>{props.state?.trim() || props.route}</span>
          </div>
        ))}
      <Overlay project={project} instance={props.instance} />
      {live && failure !== undefined && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-(--artifact-card-surface) p-6 text-center font-sans text-sm text-(--artifact-card-foreground)"
          data-testid="screen-state-failed"
        >
          <span className="font-medium text-(--artifact-card-title)">Couldn't reach this state</span>
          <span data-testid="screen-state-failed-step">{`Step ${failure.step + 1}${failedStep === undefined ? "" : `, ${describeStep(failedStep)}`}, failed: ${failure.reason}`}</span>
          <Button size="sm" className="pointer-events-auto" onPointerDown={(event) => event.stopPropagation()} onClick={fix}>
            Ask the agent to fix it
          </Button>
          {asking !== undefined && <span data-testid="screen-state-asked">{asking}</span>}
        </div>
      )}
      <SetupBadges project={project} note={live && holdsState && bridge === false ? NO_STATE_BRIDGE : undefined} />
    </HTMLContainer>
  );
};

export class ScreenShapeUtil extends BaseBoxShapeUtil<ScreenShape> {
  static override type = "screen" as const;
  static override props = screenProps;

  override getDefaultProps(): ScreenShape["props"] {
    return { w: 1280, h: 800, instance: "", route: "/", title: "" };
  }

  override canEdit() {
    return false;
  }

  override component(shape: ScreenShape) {
    return <ScreenCard shape={shape} />;
  }

  override getIndicatorPath(shape: ScreenShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }

  override onResize(shape: ScreenShape, info: TLResizeInfo<ScreenShape>) {
    return resizeBox(shape, info, { minWidth: SCREEN_MIN.w, minHeight: SCREEN_MIN.h });
  }
}
