import type { ScreenCapturePart, ScreenShapeProps } from "@unframed/contracts";
import { describeStep, fixStateInstruction, followNavigation, NO_STATE_BRIDGE, previewHostFor, screenOverlay, screenUrl, stateRoute, stepFailure, type DialsAnnouncement, type SetupChatState } from "@unframed/domain";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useValue } from "tldraw";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import type { StoreOwner } from "../canvas/doc.ts";
import { forgetFrame, hearFrame, reachFrame } from "../artifacts/state.ts";
import { messageOf, useChatClient, useChats } from "../agent/store.ts";
import { useEngine } from "../context.ts";
import { countScreens } from "../fps/screens.ts";
import { screenPropsOf } from "./BranchChip.tsx";
import { useAskAgent } from "./askAgent.ts";
import { noteBridge, repositoryState } from "./store.ts";
import { ScreenPicture } from "./ScreenPicture.tsx";

export const SCREEN_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-modals";

const NO_STATE_KEY = "[[],[]]";

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
  readonly onSnapshot: (snapshot: PageSnapshotMessage | null, final: boolean) => void;
}

export interface PageSnapshotMessage {
  readonly html: string;
  readonly w: number;
  readonly h: number;
  readonly parts: ReadonlyArray<ScreenCapturePart>;
}

export type FramePost = (message: unknown) => void;

export interface ScreenEditHooks {
  readonly onEdit: (message: { readonly type: string; readonly [key: string]: unknown }) => void;
  readonly onEditReady: (post: (message: unknown) => void) => void;
}

const LiveScreen = ({ owner, shapeId, url, dials, interactive, parked, events, edit, onPost }: {
  readonly owner: StoreOwner;
  readonly shapeId: string;
  readonly url: string;
  readonly dials: Readonly<Record<string, unknown>> | undefined;
  readonly interactive: boolean;
  readonly parked: boolean;
  readonly events: FrameEvents;
  readonly edit: ScreenEditHooks | undefined;
  readonly onPost: ((post: FramePost | undefined) => void) | undefined;
}) => {
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const saved = useRef(dials);
  saved.current = dials;
  const handlers = useRef(events);
  handlers.current = events;
  const editing = useRef(edit);
  editing.current = edit;
  const posting = useRef(onPost);
  posting.current = onPost;
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
    if (ready.current) post({ type: "unframed:dials:hello" });
    posting.current?.(post);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== target) return;
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
      else if (data.type === "unframed:snapshot") {
        const posted = data as { snapshot?: unknown; final?: unknown };
        const snapshot = typeof posted.snapshot === "object" && posted.snapshot !== null ? (posted.snapshot as PageSnapshotMessage) : null;
        if (snapshot !== null || posted.final === true) handlers.current.onSnapshot(snapshot, posted.final === true);
      } else if (data.type === "unframed:dials") {
        if (nonEmpty(saved.current)) post({ type: "unframed:dials:set", values: saved.current });
        hearFrame(owner, shapeId, data as DialsAnnouncement);
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      forgetFrame(owner, shapeId);
      posting.current?.(undefined);
    };
  }, [owner, shapeId, target]);
  const editReady = edit?.onEditReady;
  useEffect(() => {
    if (editReady === undefined) return;
    editReady(post);
    post({ type: "unframed:edit:hello" });
    return () => {
      post({ type: "unframed:edit:mode", mode: "interact", locked: [] });
      post({ type: "unframed:edit:reset" });
    };
  }, [editReady]);
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
      data-parked={parked ? "true" : undefined}
      style={{ pointerEvents: interactive && !parked ? "auto" : "none", visibility: parked ? "hidden" : undefined }}
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

export const ScreenOverlay = ({ project, instance }: { readonly project: string; readonly instance: string }) => {
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

export interface FrameStatus {
  readonly live: boolean;
  readonly painted: boolean;
}

interface ScreenFrameInput {
  readonly owner: StoreOwner;
  readonly project: string;
  readonly shapeId: string;
  readonly props: ScreenShapeProps;
  readonly interactive: boolean;
  readonly write: (next: ScreenShapeProps) => boolean;
  readonly edit?: ScreenEditHooks | undefined;
  readonly parked: boolean;
  readonly onReady: () => void;
  readonly onSnapshot: (snapshot: PageSnapshotMessage | null, final: boolean) => void;
  readonly onPost: (post: FramePost | undefined) => void;
}

export const useScreenBranch = (project: string, props: ScreenShapeProps): string => {
  const state = repositoryState(project);
  return useValue("screen branch", () => state.instances.get().get(props.instance)?.branch ?? props.title, [state, props.instance, props.title]);
};

const FixButton = ({ shapeId, instruction }: { readonly shapeId: string; readonly instruction: () => string | undefined }) => {
  const ask = useAskAgent();
  const [asking, setAsking] = useState<string | undefined>(undefined);
  const fix = () => {
    const text = instruction();
    if (text === undefined) return;
    setAsking(undefined);
    ask(shapeId as Parameters<typeof ask>[0], text).then(
      () => setAsking("Sent to the agent."),
      (error: unknown) => setAsking(messageOf(error)),
    );
  };
  return (
    <>
      <Button size="sm" className="pointer-events-auto" onPointerDown={(event) => event.stopPropagation()} onClick={fix}>
        Ask the agent to fix it
      </Button>
      {asking !== undefined && <span data-testid="screen-state-asked">{asking}</span>}
    </>
  );
};

export const useScreenFrame = ({ owner, project, shapeId, props, interactive, write, edit, parked, onReady, onSnapshot, onPost }: ScreenFrameInput): { readonly content: ReactNode; readonly failure: ReactNode; readonly status: FrameStatus } => {
  const engine = useEngine();
  const state = repositoryState(project);
  const proxyPort = useValue(
    "screen proxy",
    () => {
      const instance = state.instances.get().get(props.instance);
      return instance?.state === "live" ? instance.proxyPort : null;
    },
    [state, props.instance],
  );
  const branch = useScreenBranch(project, props);
  const live = proxyPort !== null;
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
      setLoad({ url: screenUrl(proxyPort, token === null ? props.route : stateRoute(props.route, token), previewHostFor(window.location.hostname)), n: seq, token: token !== null });
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
  const events: FrameEvents = {
    onPainted: () => {
      setPainted(load?.url);
      onReady();
    },
    onSnapshot,
    onBridge: (bridged) => {
      noteBridge(project, shapeId, bridged);
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
  const instruction = () => {
    const step = failure === undefined ? undefined : props.steps?.[failure.step];
    if (failure === undefined || step === undefined) return undefined;
    return fixStateInstruction({
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
  };
  const url = live ? load?.url : undefined;
  const shownPainted = live && url !== undefined && painted === url;
  const content = live && url !== undefined && <LiveScreen key={load?.n} owner={owner} shapeId={shapeId} url={url} dials={props.dials} interactive={interactive} parked={parked} events={events} edit={edit} onPost={onPost} />;
  const failed = live && failure !== undefined && (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-(--artifact-card-surface) p-6 text-center font-sans text-sm text-(--artifact-card-foreground)"
      data-testid="screen-state-failed"
    >
      <span className="font-medium text-(--artifact-card-title)">Couldn't reach this state</span>
      <span data-testid="screen-state-failed-step">{stepFailure(props.steps ?? [], failure.step, failure.reason)}</span>
      <FixButton shapeId={shapeId} instruction={instruction} />
    </div>
  );
  return { content, failure: failed, status: { live, painted: shownPainted && failure === undefined } };
};

export const ScreenStateNote = ({ project, shapeId, live }: { readonly project: string; readonly shapeId: string; readonly live: boolean }) => {
  const bridge = useValue("screen bridge", () => repositoryState(project).bridges.get().get(shapeId), [project, shapeId]);
  if (!live || bridge !== false) return null;
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1">
      <Badge size="sm" variant="warning" className="min-w-0 shrink" data-testid="screen-state-note">
        <span className="truncate">{NO_STATE_BRIDGE}</span>
      </Badge>
    </div>
  );
};

export const ScreenPlaceholder = ({ project, shapeId, props, painted }: { readonly project: string; readonly shapeId: string; readonly props: ScreenShapeProps; readonly painted: boolean }) => {
  const branch = useScreenBranch(project, props);
  return (
    <>
      {!painted && <ScreenPicture project={project} shapeId={shapeId} props={props} branch={branch} size="full" />}
      <ScreenOverlay project={project} instance={props.instance} />
    </>
  );
};
