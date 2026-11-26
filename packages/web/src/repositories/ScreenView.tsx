import type { ScreenShapeProps } from "@unframed/contracts";
import { describeStep, fixStateInstruction, type ScreenLoadQueue, type ScreenLoadRank, followNavigation, NO_STATE_BRIDGE, screenOverlay, screenUrl, stateRoute, stepFailure, type DialsAnnouncement, type SetupChatState } from "@unframed/domain";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useValue } from "tldraw";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import type { StoreOwner } from "../canvas/doc.ts";
import { forgetFrame, hearFrame, reachFrame } from "../artifacts/state.ts";
import { messageOf, useChatClient, useChats } from "../agent/store.ts";
import { useEngine } from "../context.ts";
import { isDeviceClient } from "../deviceMode.ts";
import { useFeature } from "../features.ts";
import { countScreens, type ScreenCounts } from "../fps/screens.ts";
import { screenPropsOf } from "./BranchChip.tsx";
import { useAskAgent } from "./askAgent.ts";
import { noteBridge, repositoryState, screenSnapshotUrl } from "./store.ts";

export const SCREEN_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-modals";

const NO_STATE_KEY = "[[],[]]";

const useCounted = (key: keyof ScreenCounts, on: boolean) =>
  useEffect(() => {
    if (!on) return;
    countScreens(key);
    return () => countScreens(key, -1);
  }, [key, on]);

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

export interface ScreenEditHooks {
  readonly onEdit: (message: { readonly type: string; readonly [key: string]: unknown }) => void;
  readonly onEditReady: (post: (message: unknown) => void) => void;
}

const LiveScreen = ({ owner, shapeId, url, dials, interactive, events, edit }: {
  readonly owner: StoreOwner;
  readonly shapeId: string;
  readonly url: string;
  readonly dials: Readonly<Record<string, unknown>> | undefined;
  readonly interactive: boolean;
  readonly events: FrameEvents;
  readonly edit: ScreenEditHooks | undefined;
}) => {
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const saved = useRef(dials);
  saved.current = dials;
  const handlers = useRef(events);
  handlers.current = events;
  const editing = useRef(edit);
  editing.current = edit;
  const target = new URL(url).origin;
  const post = (message: unknown) => {
    try {
      frame.current?.contentWindow?.postMessage(message, target);
    } catch {
      return;
    }
  };
  useEffect(() => {
    reachFrame(owner, shapeId, (values) => post({ type: "unframed:dials:set", values }));
    editing.current?.onEditReady(post);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: unknown; route?: unknown; state?: unknown; replaying?: unknown; ok?: unknown; step?: unknown; reason?: unknown } | null;
      if (typeof data !== "object" || data === null) return;
      if (typeof data.type === "string" && data.type.startsWith("unframed:edit:")) {
        editing.current?.onEdit(data as { type: string });
        return;
      }
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
        hearFrame(owner, shapeId, data as DialsAnnouncement);
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      forgetFrame(owner, shapeId);
    };
  }, [owner, shapeId, target]);
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

const StateNote = ({ note }: { readonly note: string | undefined }) =>
  note === undefined ? null : (
    <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1">
      <Badge size="sm" variant="warning" className="min-w-0 shrink" data-testid="screen-state-note">
        <span className="truncate">{note}</span>
      </Badge>
    </div>
  );

export interface ScreenViewInput {
  readonly owner: StoreOwner;
  readonly project: string;
  readonly shapeId: string;
  readonly props: ScreenShapeProps;
  readonly onScreen: boolean;
  readonly interactive: boolean;
  readonly write: (next: ScreenShapeProps) => boolean;
  readonly edit?: ScreenEditHooks | undefined;
  readonly turn?: { readonly queue: ScreenLoadQueue; readonly rank: () => ScreenLoadRank } | undefined;
}

export const useScreenView = ({ owner, project, shapeId, props, onScreen, interactive, write, edit, turn }: ScreenViewInput): { readonly content: ReactNode; readonly painted: boolean; readonly live: boolean; readonly queued: boolean; readonly branch: string } => {
  const engine = useEngine();
  const ask = useAskAgent();
  const repositories = useFeature("repositories");
  const state = repositoryState(project);
  const proxyPort = useValue(
    "screen proxy",
    () => {
      const instance = state.instances.get().get(props.instance);
      return instance?.state === "live" ? instance.proxyPort : null;
    },
    [state, props.instance],
  );
  const branch = useValue("screen branch", () => state.instances.get().get(props.instance)?.branch ?? props.title, [state, props.instance, props.title]);
  const eligible = repositories && !isDeviceClient() && onScreen && proxyPort !== null;
  const [admitted, setAdmitted] = useState(false);
  const ranking = useRef(turn?.rank);
  ranking.current = turn?.rank;
  const loadQueue = turn?.queue;
  useEffect(() => {
    setAdmitted(false);
    if (!eligible || loadQueue === undefined) return;
    return loadQueue.enter(shapeId, () => ranking.current?.() ?? { selected: false, distance: 0 }, () => setAdmitted(true));
  }, [eligible, loadQueue, shapeId]);
  const queued = eligible && loadQueue !== undefined && !admitted;
  const live = eligible && !queued;
  const [settled, setSettled] = useState<number | undefined>(undefined);
  const snapshot = useValue("screen snapshot", () => state.snapshots.get().get(shapeId), [state, shapeId]);
  const bridge = useValue("screen bridge", () => state.bridges.get().get(shapeId), [state, shapeId]);
  const stateKey = JSON.stringify([props.steps ?? [], props.mocks ?? []]);
  const holdsState = stateKey !== NO_STATE_KEY;
  const shown = useRef<{ readonly route: string; readonly stateKey: string; readonly port: number; readonly reloads: number } | undefined>(undefined);
  const loads = useRef(0);
  const [load, setLoad] = useState<{ readonly url: string; readonly n: number; readonly token: boolean } | undefined>(undefined);
  const frameState = useRef<{ applied: boolean; route: string | undefined }>({ applied: false, route: undefined });
  const [reloads, setReloads] = useState(0);
  const retried = useRef(false);
  useEffect(() => {
    retried.current = false;
  }, [props.route, stateKey]);
  const [failure, setFailure] = useState<{ readonly step: number; readonly reason: string } | undefined>(undefined);
  const [asking, setAsking] = useState<string | undefined>(undefined);
  const [painted, setPainted] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!live || proxyPort === null) {
      shown.current = undefined;
      setPainted(undefined);
      setLoad(undefined);
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
      if (token !== null) countScreens("replays");
      frameState.current = { applied: false, route: undefined };
      setLoad({ url: screenUrl(proxyPort, token === null ? props.route : stateRoute(props.route, token)), n: seq, token: token !== null });
    };
    if (!holdsState) begin(null);
    else engine.call("screens.stateToken", { project, instance: props.instance, steps: props.steps ?? [], mocks: props.mocks ?? [] }).then(({ token }) => begin(token), () => begin(null));
  }, [live, proxyPort, props.route, stateKey, reloads]);
  const follow = (route: string) => {
    const current = screenPropsOf(owner, shapeId);
    if (current === undefined) return;
    const next = followNavigation(current, route);
    if (next === undefined || shown.current === undefined) return;
    const before = shown.current;
    shown.current = { ...before, route: next.route, stateKey: NO_STATE_KEY };
    if (!write(next)) {
      shown.current = before;
      return;
    }
    setFailure(undefined);
  };
  const loaded = () => {
    setSettled(load?.n);
    loadQueue?.done(shapeId);
  };
  const events: FrameEvents = {
    onPainted: () => {
      setPainted(load?.url);
      if (load?.token !== true) loaded();
    },
    onBridge: (bridged) => {
      noteBridge(project, shapeId, bridged);
      if (!bridged) loaded();
    },
    onReady: (route, applied) => {
      const frame = frameState.current;
      if (applied) {
        frameState.current = { applied: true, route };
        return;
      }
      if (route === undefined) return;
      if (holdsState && load?.token === true && frame.applied && route === frame.route) setReloads((count) => count + 1);
      else if (route !== props.route) follow(route);
    },
    onRoute: (route, replaying) => {
      frameState.current = { ...frameState.current, route };
      if (!replaying) follow(route);
    },
    onSteps: (result) => {
      loaded();
      if (result.ok) {
        retried.current = false;
        setFailure(undefined);
      } else if (!retried.current) {
        retried.current = true;
        countScreens("retries");
        setReloads((count) => count + 1);
      } else {
        countScreens("failed");
        setFailure({ step: result.step ?? 0, reason: result.reason ?? "" });
      }
    },
  };
  const fix = () => {
    const step = failure === undefined ? undefined : props.steps?.[failure.step];
    if (failure === undefined || step === undefined) return;
    const instruction = fixStateInstruction({
      shape: shapeId.replace(/^shape:/, ""),
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
    ask(shapeId as Parameters<typeof ask>[0], instruction).then(
      () => setAsking("Sent to the agent."),
      (error: unknown) => setAsking(messageOf(error)),
    );
  };
  const url = live ? load?.url : undefined;
  const shownPainted = live && url !== undefined && painted === url;
  useCounted("live", live && url !== undefined);
  useCounted("loading", live && (load === undefined || settled !== load.n));
  useCounted("queued", queued);
  const content = (
    <>
      {live && url !== undefined && <LiveScreen key={load?.n} owner={owner} shapeId={shapeId} url={url} dials={props.dials} interactive={interactive} events={events} edit={edit} />}
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
          <span data-testid="screen-state-failed-step">{stepFailure(props.steps ?? [], failure.step, failure.reason)}</span>
          <Button size="sm" className="pointer-events-auto" onPointerDown={(event) => event.stopPropagation()} onClick={fix}>
            Ask the agent to fix it
          </Button>
          {asking !== undefined && <span data-testid="screen-state-asked">{asking}</span>}
        </div>
      )}
      <StateNote note={live && bridge === false ? NO_STATE_BRIDGE : undefined} />
    </>
  );
  return { content, painted: shownPainted, live, queued, branch };
};
