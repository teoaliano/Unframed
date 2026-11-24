import type { ScreenShapeProps } from "@unframed/contracts";
import { screenOverlay, screenUrl, setupTag, type DialsAnnouncement } from "@unframed/domain";
import { useEffect, useRef, useState } from "react";
import { BaseBoxShapeUtil, HTMLContainer, resizeBox, T, useEditor, useValue, type RecordProps, type TLResizeInfo, type TLShape } from "tldraw";
import { Badge } from "~/components/ui/badge";
import { Spinner } from "~/components/ui/spinner";
import { forgetFrame, hearFrame, isInteractive, reachFrame } from "../../artifacts/state.ts";
import { useCanvasProject } from "../../context.ts";
import { isDeviceClient } from "../../deviceMode.ts";
import { useFeature } from "../../features.ts";
import { noteRender } from "../../fps/renders.ts";
import { screenOnScreen } from "../../repositories/demand.ts";
import { repositoryState, screenSnapshotUrl } from "../../repositories/store.ts";
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
};

export const SCREEN_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-modals";

const nonEmpty = (dials: Readonly<Record<string, unknown>> | undefined) => dials !== undefined && Object.keys(dials).length > 0;

const LiveScreen = ({ shapeId, url, dials, interactive, onPainted, onBridge }: {
  readonly shapeId: string;
  readonly url: string;
  readonly dials: Readonly<Record<string, unknown>> | undefined;
  readonly interactive: boolean;
  readonly onPainted: () => void;
  readonly onBridge: (bridge: boolean) => void;
}) => {
  const editor = useEditor();
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const saved = useRef(dials);
  saved.current = dials;
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
      const data = event.data as { type?: unknown } | null;
      if (typeof data !== "object" || data === null) return;
      if (data.type === "unframed:screen:ready") {
        ready.current = true;
        onBridge(true);
        post({ type: "unframed:dials:hello" });
      } else if (data.type === "unframed:screen:paint") onPainted();
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
      title={url}
      src={url}
      sandbox={SCREEN_SANDBOX}
      referrerPolicy="no-referrer"
      allow=""
      data-interactive={interactive ? "true" : undefined}
      style={{ pointerEvents: interactive ? "auto" : "none" }}
      onLoad={() => {
        if (ready.current) post({ type: "unframed:dials:hello" });
        else {
          onBridge(false);
          onPainted();
        }
      }}
    />
  );
};

const Overlay = ({ project, instance }: { readonly project: string; readonly instance: string }) => {
  const state = repositoryState(project);
  const overlay = useValue(
    "screen overlay",
    () => screenOverlay({ instance: state.instances.get().get(instance), loaded: state.loaded.get(), repository: state.repository.get()?.status }),
    [state, instance],
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
      {overlay.kind === "failed" && overlay.log !== "" && (
        <pre className="max-w-full overflow-hidden text-start font-mono text-xs whitespace-pre-wrap" data-testid="screen-log">
          {overlay.log}
        </pre>
      )}
    </div>
  );
};

const SetupTags = ({ project }: { readonly project: string }) => {
  const setup = useValue("repository setup", () => repositoryState(project).repository.get()?.setup ?? null, [project]);
  const tag = setupTag(setup);
  const warnings = setup?.warnings ?? [];
  if (tag === undefined && warnings.length === 0) return null;
  return (
    <div className="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-1">
      {tag !== undefined && (
        <Badge variant="secondary" data-testid="screen-mock-tag">
          {tag}
        </Badge>
      )}
      {warnings.map((warning) => (
        <Badge key={warning} variant="warning" data-testid="screen-warning">
          {warning}
        </Badge>
      ))}
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
  const onScreen = useValue("screen on screen", () => screenOnScreen(editor, shape.id), [editor, shape.id]);
  const interactive = useValue("screen interactive", () => isInteractive(editor, shape.id), [editor, shape.id]);
  const live = repositories && !isDeviceClient() && onScreen && proxyPort !== null;
  const url = proxyPort === null ? undefined : screenUrl(proxyPort, props.route);
  const [painted, setPainted] = useState<string | undefined>(undefined);
  const shownPainted = live && painted === url;
  const [, setBridge] = useState<boolean | undefined>(undefined);
  return (
    <HTMLContainer
      id={shape.id}
      className={`${artifactCardClass} overflow-hidden`}
      data-testid="screen"
      data-route={props.route}
      data-live={live ? "true" : undefined}
      data-painted={shownPainted ? "true" : undefined}
      style={{ width: props.w, height: props.h }}
    >
      <ShapeLabel shapeId={shape.id} kind="screen" width={props.w} text={`${props.title} ${props.route}`.trim()} />
      {live && url !== undefined && <LiveScreen key={url} shapeId={shape.id} url={url} dials={props.dials} interactive={interactive} onPainted={() => setPainted(url)} onBridge={setBridge} />}
      {!shownPainted &&
        (snapshot !== undefined ? (
          <img className="pointer-events-none absolute inset-0 block size-full object-cover select-none" data-testid="screen-snapshot" src={screenSnapshotUrl(project, snapshot)} alt="" draggable={false} />
        ) : (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-(--artifact-card-surface) p-3 text-center font-sans text-sm text-(--artifact-card-foreground)">
            <span className="font-medium text-(--artifact-card-title)">{props.title}</span>
            <span>{props.route}</span>
          </div>
        ))}
      <Overlay project={project} instance={props.instance} />
      <SetupTags project={project} />
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
