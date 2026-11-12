import { NODE_MIN_HEIGHT, NODE_WIDTH, type NodeShapeProps, type NodeVersion } from "@unframed/contracts";
import { currentVersion, modelPart, nodeCatalogueOf, nodeProvider, nodeStatus, providerLabel, readRef } from "@unframed/domain";
import { AppWindow, AudioLines, FileText, Workflow } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BaseBoxShapeUtil, HTMLContainer, resizeBox, T, useEditor, useValue, type RecordProps, type TLResizeInfo } from "tldraw";
import { Badge } from "~/components/ui/badge";
import { fileUrl } from "../canvas/assetStore.ts";
import { ShapeLabel } from "../canvas/shapes/ShapeLabel.tsx";
import { useCanvasProject, useEngine } from "../context.ts";
import { useKnownCatalogue } from "../generate/catalogue.ts";
import { useFeature } from "../features.ts";
import { noteRender } from "../fps/renders.ts";
import { type NodeShape } from "./facts.ts";
import { nodeStatusOf } from "./graph.ts";
import { NodeEditor } from "./NodeEditor.tsx";
import { nodeStartValues } from "./nodeTray.ts";
import { newNodeProps, nodeFrames } from "./operations.ts";

const versionProps = T.object({
  id: T.string,
  runId: T.string,
  chainId: T.string.nullable(),
  batchId: T.string,
  runIndex: T.number,
  status: T.literalEnum("running", "done"),
  file: T.string.optional(),
  fileName: T.string.optional(),
  text: T.string.optional(),
  fingerprint: T.string,
  createdAt: T.string,
  error: T.string.optional(),
  durable: T.boolean.optional(),
});

const nodeShapeProps = {
  w: T.nonZeroNumber,
  h: T.nonZeroNumber,
  medium: T.literalEnum("image", "video", "text", "audio", "page"),
  model: T.string,
  params: T.dict(T.string, T.or(T.string, T.or(T.number, T.boolean))),
  runs: T.number.optional(),
  instruction: T.string,
  versions: T.arrayOf(versionProps),
  currentVersionId: T.string.nullable(),
  run: T.object({ runId: T.string, chainId: T.string.nullable(), startedAt: T.number }).optional(),
  error: T.string.optional(),
} as unknown as RecordProps<NodeShape>;

export const MEDIUM_WORDS: Record<NodeShapeProps["medium"], string> = { image: "Image", video: "Video", text: "Text", audio: "Audio", page: "Page" };

const STATE_TONE: Record<string, string> = {
  running: "bg-(--node-status-indicator-running)",
  failed: "bg-(--node-status-indicator-failed)",
  waiting: "bg-(--node-status-indicator-waiting)",
  out_of_date: "bg-(--node-status-indicator-out-of-date)",
  not_run: "bg-(--node-status-indicator)/(--node-status-indicator-opacity)",
  ready: "bg-(--node-status-indicator-ready)",
};

export const VersionView = ({ version, medium, fit = "contain" }: { readonly version: NodeVersion; readonly medium: NodeShapeProps["medium"]; readonly fit?: "contain" | "cover" }) => {
  const project = useCanvasProject();
  if (version.text !== undefined && (medium === "text" || version.file === undefined || version.file.endsWith(".json"))) {
    return (
      <div className="size-full overflow-hidden p-2 text-xs leading-relaxed whitespace-pre-wrap text-(--node-foreground)" data-testid="node-text">
        {version.text}
      </div>
    );
  }
  if (version.file === undefined) return null;
  const url = fileUrl(project, version.file);
  if (medium === "image") return <img className={`pointer-events-none block size-full select-none ${fit === "cover" ? "object-cover" : "object-contain"}`} src={url} alt="" draggable={false} data-testid="node-image" />;
  if (medium === "video") return <video className={`pointer-events-none block size-full ${fit === "cover" ? "object-cover" : "object-contain"}`} src={url} muted preload="metadata" data-testid="node-video" />;
  const Icon = medium === "page" ? AppWindow : medium === "audio" ? AudioLines : FileText;
  return (
    <div className="flex size-full flex-col items-center justify-center gap-1.5 p-2 text-center text-xs text-(--node-result-foreground)" data-testid={`node-${medium}`}>
      <Icon className="size-6" strokeWidth={1.5} aria-hidden />
      <span className="line-clamp-2 text-(--node-foreground)">{version.fileName ?? version.file}</span>
    </div>
  );
};

const StatusLine = ({ shape }: { readonly shape: NodeShape }) => {
  const editor = useEditor();
  const status = useValue("node status", () => nodeStatusOf(editor, shape.id), [editor, shape.id]);
  if (!status || status.state === "ready") return null;
  return (
    <div className="flex min-h-5 items-start gap-1.5 text-xs" data-testid="node-status" data-state={status.state} role={status.state === "failed" ? "alert" : "status"}>
      <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${STATE_TONE[status.state] ?? "bg-(--node-status-indicator)"}`} aria-hidden data-testid="node-status-dot" />
      <span className={status.state === "failed" ? "text-(--node-status-foreground-failed)" : "text-(--node-status-foreground)"}>
        {status.line}
      </span>
    </div>
  );
};

const useFreshValues = (shape: NodeShape) => {
  const editor = useEditor();
  const engine = useEngine();
  const fresh = (shape.meta.unframed as { fresh?: boolean } | undefined)?.fresh === true;
  useEffect(() => {
    if (!fresh) return;
    let live = true;
    void (async () => {
      const keys = await engine.call("settings.get").catch(() => undefined);
      const values = await nodeStartValues(engine, keys, "image");
      if (!live) return;
      const now = editor.getShape(shape.id);
      if (!now || now.type !== "node") return;
      const { fresh: _fresh, ...unframed } = (now.meta.unframed as Record<string, unknown> | undefined) ?? {};
      editor.run(
        () =>
          editor.updateShape<NodeShape>({
            id: shape.id,
            type: "node",
            props: { ...(now as NodeShape).props, model: values.model, params: values.params, ...(values.runs === undefined ? {} : { runs: values.runs }), ...(values.provider === undefined ? {} : { provider: values.provider }) },
            meta: { ...now.meta, unframed: unframed as never },
          }),
        { history: "ignore" },
      );
    })();
    return () => {
      live = false;
    };
  }, [editor, engine, fresh, shape.id]);
};

const NodeCard = ({ shape }: { readonly shape: NodeShape }) => {
  noteRender(shape.id);
  useFreshValues(shape);
  const editor = useEditor();
  const nodesOn = useFeature("nodes");
  const live = useValue("node live", () => nodesOn && editor.getOnlySelectedShapeId() === shape.id, [editor, shape.id, nodesOn]);
  const scroller = useRef<HTMLDivElement>(null);
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = scroller.current;
    if (!element || !live) return;
    element.scrollTop = 0;
    const stop = (event: WheelEvent) => {
      if (element.scrollHeight > element.clientHeight && !event.ctrlKey) event.stopPropagation();
    };
    element.addEventListener("wheel", stop, { passive: true });
    return () => element.removeEventListener("wheel", stop);
  }, [live]);
  const props = shape.props;
  const engine = useEngine();
  const list = useKnownCatalogue(engine, nodeCatalogueOf(props.medium), nodeProvider(props));
  const shownModel = props.model !== "" ? props.model : (list?.default ?? "");
  const current = currentVersion({ ...props, id: shape.id } as never);
  const name = readRef(shape);
  return (
    <HTMLContainer id={shape.id} className="box-border flex flex-col rounded-xl border border-(--node-border) bg-(--node-surface) font-sans text-(--node-foreground) shadow-xs/5" data-testid="node-card" data-node-live={live ? "true" : undefined} data-medium={props.medium} style={{ width: props.w, height: props.h }}>
      <ShapeLabel shapeId={shape.id} kind="node" name={name} width={props.w} text={name !== undefined ? `@${name}` : "Node"} />
      <div className="flex shrink-0 flex-col gap-2 px-2.5 pt-2.5 pb-2" data-testid="node-header">
        <div className="flex items-center gap-1.5">
          <Workflow className="size-3.5 text-(--node-icon)" aria-hidden />
          <Badge variant="outline" data-testid="node-medium">
            {MEDIUM_WORDS[props.medium]}
          </Badge>
          <Badge variant="outline" data-testid="node-model">
            <span className="max-w-44 truncate">{modelPart(shownModel) || "Default model"}</span>
          </Badge>
          {providerLabel(nodeProvider(props)).map((label) => (
            <Badge key={label} variant="outline" data-testid="node-provider">
              {label}
            </Badge>
          ))}
          {props.versions.length > 1 && <span className="ml-auto text-2xs text-(--node-meta) tabular-nums" data-testid="node-version-count">{`${props.versions.length} versions`}</span>}
        </div>
        <StatusLine shape={shape} />
      </div>
      <div ref={scroller} className={`flex min-h-0 flex-1 flex-col gap-2 px-2.5 pb-2.5 ${live ? "pointer-events-auto overflow-y-auto" : "overflow-hidden"}`} data-testid="node-body">
        {live ? (
          <NodeEditor shape={shape} footer={footer} />
        ) : (
          <>
            <div className="relative min-h-24 flex-1 overflow-hidden rounded-lg border border-(--node-border) bg-(--node-result-surface)/(--node-result-surface-opacity)" data-testid="node-result">
              {current ? <VersionView version={current} medium={props.medium} /> : <div className="flex size-full items-center justify-center text-xs text-(--node-result-foreground)">No result yet</div>}
            </div>
            {props.instruction.trim() !== "" && (
              <p className="m-0 line-clamp-2 text-xs text-(--node-note)" data-testid="node-instruction">
                {props.instruction}
              </p>
            )}
          </>
        )}
      </div>
      {live && <div ref={setFooter} className="pointer-events-auto shrink-0 border-t px-2.5 py-2" data-testid="node-footer" />}
    </HTMLContainer>
  );
};

export class NodeShapeUtil extends BaseBoxShapeUtil<NodeShape> {
  static override type = "node" as const;
  static override props = nodeShapeProps;

  override getDefaultProps(): NodeShapeProps {
    return newNodeProps("image", {});
  }

  override canEdit() {
    return false;
  }

  override component(shape: NodeShape) {
    return <NodeCard shape={shape} />;
  }

  override getIndicatorPath(shape: NodeShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 12);
    return path;
  }

  override onResize(shape: NodeShape, info: TLResizeInfo<NodeShape>) {
    return resizeBox(shape, info, { minWidth: NODE_WIDTH.min, maxWidth: NODE_WIDTH.max, minHeight: NODE_MIN_HEIGHT });
  }
}
