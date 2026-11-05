import { NODE_MIN_HEIGHT, NODE_WIDTH, type NodeShapeProps, type NodeVersion } from "@unframed/contracts";
import { currentVersion, modelPart, nodeStatus, readRef } from "@unframed/domain";
import { AppWindow, AudioLines, FileText, Workflow } from "lucide-react";
import { useEffect, useRef } from "react";
import { BaseBoxShapeUtil, HTMLContainer, resizeBox, T, useEditor, useValue, type RecordProps, type TLResizeInfo } from "tldraw";
import { Badge } from "~/components/ui/badge";
import { fileUrl } from "../canvas/assetStore.ts";
import { ShapeLabel } from "../canvas/shapes/ShapeLabel.tsx";
import { useCanvasProject, useEngine } from "../context.ts";
import { loadLastUsed } from "../generate/lastUsed.ts";
import { mediumDefinition } from "../generate/mediumRegistry.ts";
import { noteRender } from "../fps/renders.ts";
import { nodeCanvas, type NodeShape } from "./facts.ts";
import { NodeEditor } from "./NodeEditor.tsx";
import { newNodeProps, nodeFrames, nodeModel } from "./operations.ts";

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
  running: "bg-info",
  failed: "bg-destructive",
  waiting: "bg-warning",
  out_of_date: "bg-warning",
  not_run: "bg-muted-foreground/48",
  ready: "bg-success",
};

/** What a version shows: its picture, its clip's first frame, its text, its page or its sound. */
export const VersionView = ({ version, medium, fit = "contain" }: { readonly version: NodeVersion; readonly medium: NodeShapeProps["medium"]; readonly fit?: "contain" | "cover" }) => {
  const project = useCanvasProject();
  if (version.text !== undefined && (medium === "text" || version.file === undefined || version.file.endsWith(".json"))) {
    return (
      <div className="size-full overflow-hidden p-2 text-xs leading-relaxed whitespace-pre-wrap text-foreground" data-testid="node-text">
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
    <div className="flex size-full flex-col items-center justify-center gap-1.5 p-2 text-center text-xs text-muted-foreground" data-testid={`node-${medium}`}>
      <Icon className="size-6" strokeWidth={1.5} aria-hidden />
      <span className="line-clamp-2 text-foreground">{version.fileName ?? version.file}</span>
    </div>
  );
};

const StatusLine = ({ shape }: { readonly shape: NodeShape }) => {
  const editor = useEditor();
  const status = useValue(
    "node status",
    () => {
      const canvas = nodeCanvas(editor);
      const node = canvas.nodes.get(shape.id);
      return node ? nodeStatus({ node, canvas, frames: nodeFrames(node) }) : undefined;
    },
    [editor, shape.id],
  );
  if (!status || status.state === "ready") return null;
  return (
    <div className="flex min-h-5 items-start gap-1.5 text-xs" data-testid="node-status" data-state={status.state} role={status.state === "failed" ? "alert" : "status"}>
      <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${STATE_TONE[status.state] ?? "bg-muted-foreground"}`} aria-hidden data-testid="node-status-dot" />
      <span className={status.state === "failed" ? "text-destructive-foreground" : "text-foreground"}>
        {status.line}
      </span>
    </div>
  );
};

/** A node made from the add menu starts with the image medium's last-used values (spec 03), then keeps its own. */
const useFreshValues = (shape: NodeShape) => {
  const editor = useEditor();
  const engine = useEngine();
  const fresh = (shape.meta.unframed as { fresh?: boolean } | undefined)?.fresh === true;
  useEffect(() => {
    if (!fresh) return;
    let live = true;
    void (async () => {
      const stored = await loadLastUsed(engine, "image");
      const list = await engine.call("models.list", { medium: "image" }).catch(() => undefined);
      if (!live) return;
      const now = editor.getShape(shape.id);
      if (!now || now.type !== "node") return;
      const definition = mediumDefinition("image");
      const model = stored?.model !== undefined && list?.models.some((each) => each.id === stored.model) ? stored.model : "";
      const entry = list?.models.find((each) => each.id === (model || list.default));
      const params = definition ? (stored ? definition.keep(stored.props, definition.params(entry, stored.props)) : definition.defaults(definition.params(entry))) : {};
      const { runs, ...rest } = params as Record<string, string | number | boolean>;
      const { fresh: _fresh, ...unframed } = (now.meta.unframed as Record<string, unknown> | undefined) ?? {};
      editor.run(
        () =>
          editor.updateShape<NodeShape>({
            id: shape.id,
            type: "node",
            props: { ...(now as NodeShape).props, model, params: rest, ...(typeof runs === "number" && runs > 1 ? { runs } : {}) },
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
  const live = useValue("node live", () => editor.getOnlySelectedShapeId() === shape.id, [editor, shape.id]);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = scroller.current;
    if (!element || !live) return;
    const stop = (event: WheelEvent) => {
      if (element.scrollHeight > element.clientHeight && !event.ctrlKey) event.stopPropagation();
    };
    element.addEventListener("wheel", stop, { passive: true });
    return () => element.removeEventListener("wheel", stop);
  }, [live]);
  const props = shape.props;
  const current = currentVersion({ ...props, id: shape.id } as never);
  const name = readRef(shape);
  return (
    <HTMLContainer id={shape.id} className="box-border flex flex-col rounded-xl border bg-card font-sans text-foreground shadow-xs/5" data-testid="node-card" data-node-live={live ? "true" : undefined} data-medium={props.medium} style={{ width: props.w, height: props.h }}>
      <ShapeLabel shapeId={shape.id} kind="node" name={name} width={props.w} text={name !== undefined ? `@${name}` : "Node"} />
      <div ref={scroller} className={`flex min-h-0 flex-1 flex-col gap-2 p-2.5 ${live ? "pointer-events-auto overflow-y-auto" : "overflow-hidden"}`}>
        <div className="flex items-center gap-1.5">
          <Workflow className="size-3.5 text-muted-foreground" aria-hidden />
          <Badge variant="outline" data-testid="node-medium">
            {MEDIUM_WORDS[props.medium]}
          </Badge>
          <Badge variant="outline" data-testid="node-model">
            <span className="max-w-44 truncate">{modelPart(nodeModel(props)) || "Default model"}</span>
          </Badge>
          {props.versions.length > 1 && <span className="ml-auto text-2xs text-muted-foreground tabular-nums" data-testid="node-version-count">{`${props.versions.length} versions`}</span>}
        </div>
        <StatusLine shape={shape} />
        {live ? (
          <NodeEditor shape={shape} />
        ) : (
          <>
            <div className="relative min-h-24 flex-1 overflow-hidden rounded-lg border bg-muted/40" data-testid="node-result">
              {current ? <VersionView version={current} medium={props.medium} /> : <div className="flex size-full items-center justify-center text-xs text-muted-foreground">No result yet</div>}
            </div>
            {props.instruction.trim() !== "" && (
              <p className="m-0 line-clamp-2 text-xs text-muted-foreground" data-testid="node-instruction">
                {props.instruction}
              </p>
            )}
          </>
        )}
      </div>
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
