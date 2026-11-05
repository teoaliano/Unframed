import type { ArtifactShapeProps } from "@unframed/contracts";
import { artifactLayoutSize, artifactScale, artifactTitle, readRef, type ArtifactKind, type DialsAnnouncement } from "@unframed/domain";
import { AppWindow, Clapperboard, Component } from "lucide-react";
import { useCallback, useEffect, type ReactNode } from "react";
import { BaseBoxShapeUtil, HTMLContainer, resizeBox, T, useEditor, useValue, type RecordProps, type TLResizeInfo, type TLShape, type TLShapeId } from "tldraw";
import { ArtifactFrame, type ArtifactFrameProps, type EditMessage } from "../../artifacts/ArtifactFrame.tsx";
import { DropOutline, onFrameEdit } from "../../artifacts/imageDrop.tsx";
import { ProblemLine, RenderRow } from "../../artifacts/RenderRow.tsx";
import { Button } from "~/components/ui/button";
import { snapshotsOf, snapshotUrl, stillOf } from "../../artifacts/snapshots.ts";
import { kitOf } from "../../artifacts/kit.ts";
import { artifactsOf, forgetEdit, forgetFrame, hearFrame, isInteractive, isLive, previewPort, reachEdit, reachFrame } from "../../artifacts/state.ts";
import { Tip } from "../../chrome/ui.tsx";
import { currentSlots } from "../../chrome/slots.ts";
import { updateTagsOf } from "../../artifacts/updates.ts";
import { useCanvasProject } from "../../context.ts";
import { artifactCardClass } from "./looks.ts";
import { nameOf, waitingLabel } from "./labels.ts";
import { ShapeLabel } from "./ShapeLabel.tsx";
import { noteRender } from "../../fps/renders.ts";

export const ARTIFACT_DEFAULT_SIZE = { w: 480, h: 320 };
const ARTIFACT_MIN = { w: 180, h: 96 };

type ArtifactShape = TLShape<"page"> | TLShape<"motion"> | TLShape<"component">;

const artifactProps: RecordProps<TLShape<"page"> | TLShape<"motion">> = {
  w: T.nonZeroNumber,
  h: T.nonZeroNumber,
  file: T.string,
  title: T.string,
  fileName: T.string,
  dials: T.dict(T.string, T.jsonValue).optional(),
  mode: T.string.optional(),
  scale: T.number.optional(),
};

const componentProps: RecordProps<TLShape<"component">> = { w: T.nonZeroNumber, h: T.nonZeroNumber, file: T.string, title: T.string, fileName: T.string, tag: T.string };

const RENDER_ROW_HEIGHT = 34;

const KIND_NAMES: Record<ArtifactKind, string> = { page: "Page", motion: "Motion", component: "Component" };

const EmptyArtifact = ({ shape, kind }: { readonly shape: ArtifactShape; readonly kind: ArtifactKind }) => {
  noteRender(shape.id);
  const word = KIND_NAMES[kind];
  const Icon = kind === "page" ? AppWindow : kind === "component" ? Component : Clapperboard;
  const props = shape.props as ArtifactShapeProps;
  return (
    <>
      <HTMLContainer id={shape.id} className={artifactCardClass} data-testid="artifact-card" data-artifact-kind={kind} style={{ width: props.w, height: props.h }}>
        <ShapeLabel shapeId={shape.id} kind={kind} name={readRef(shape)} width={props.w} text={waitingLabel(shape, word)} />
        <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
          <Icon className="size-7" strokeWidth={1.5} aria-label={word} />
        </div>
      </HTMLContainer>
      <ProblemLine shapeId={shape.id} offset={props.h} width={props.w} />
    </>
  );
};

const Still = ({ shape, title }: { readonly shape: ArtifactShape; readonly title: string }) => {
  const project = useCanvasProject();
  const file = (shape.props as ArtifactShapeProps).file;
  const current = useValue("artifact snapshot", () => {
    const snapshot = snapshotsOf(project).get().get(file);
    return snapshot === undefined ? undefined : snapshotUrl(project, snapshot);
  }, [project, file]);
  const src = stillOf(project, shape.id, current);
  if (src !== undefined) return <img className="pointer-events-none block size-full object-cover select-none" data-testid="artifact-snapshot" src={src} alt="" draggable={false} />;
  return (
    <div className={`${artifactCardClass} flex size-full flex-col items-center justify-center gap-1 p-3 text-center font-sans text-xs text-muted-foreground`}>
      {title !== "" && <span className="text-sm font-medium text-foreground">{title}</span>}
      <span>Select to preview</span>
    </div>
  );
};

const Scaled = ({ scale, layout, children }: { readonly scale: number; readonly layout: { w: number; h: number }; readonly children: ReactNode }) => (
  <div data-artifact-scale={scale} className="relative origin-top-left" style={{ width: layout.w, height: layout.h, transform: scale === 1 ? undefined : `scale(${scale})` }}>
    {children}
  </div>
);

const CanvasFrame = ({ shapeId, ...props }: Omit<ArtifactFrameProps, "onAnnounce" | "onReady"> & { readonly shapeId: string }) => {
  const editor = useEditor();
  useEffect(() => () => forgetFrame(editor, shapeId), [editor, shapeId]);
  const onAnnounce = useCallback((announcement: DialsAnnouncement) => hearFrame(editor, shapeId, announcement), [editor, shapeId]);
  const onReady = useCallback((post: (values: unknown) => void) => reachFrame(editor, shapeId, post), [editor, shapeId]);
  useEffect(() => () => forgetEdit(editor, shapeId), [editor, shapeId]);
  const onEdit = useCallback((message: EditMessage) => onFrameEdit(editor, shapeId, message), [editor, shapeId]);
  const onEditReady = useCallback((post: (message: unknown) => void) => reachEdit(editor, shapeId, post), [editor, shapeId]);
  return <ArtifactFrame {...props} onAnnounce={onAnnounce} onReady={onReady} onEdit={onEdit} onEditReady={onEditReady} />;
};

const UpdatesBadge = ({ shapeId }: { readonly shapeId: TLShapeId }) => {
  const editor = useEditor();
  return (
    <Tip label="Component updates available">
      <Button
        variant="outline"
        size="xs"
        data-testid="component-updates-badge"
        aria-label="Component updates available"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => {
          artifactsOf(editor).updatesOpen.set(shapeId);
          currentSlots().openArtifact?.(editor, shapeId);
        }}
      >
        <Component aria-hidden />
        Updates
      </Button>
    </Tip>
  );
};

const FilledArtifact = ({ shape, kind }: { readonly shape: ArtifactShape; readonly kind: ArtifactKind }) => {
  noteRender(shape.id);
  const editor = useEditor();
  const project = useCanvasProject();
  const props = shape.props as ArtifactShapeProps;
  const live = useValue("artifact live", () => isLive(editor, shape.id), [editor, shape.id]);
  const interactive = useValue("artifact interactive", () => live && isInteractive(editor, shape.id), [editor, shape.id, live]);
  const port = useValue("preview port", () => previewPort.get(), []);
  const kit = useValue("project kit", () => kitOf(editor), [editor]);
  const title = artifactTitle(props);
  const name = nameOf(shape);
  const scale = kind === "component" ? 1 : artifactScale(props);
  const layout = artifactLayoutSize({ w: props.w, h: props.h, scale });
  const updates = useValue("component updates", () => updateTagsOf(editor, project, props.file).join(","), [editor, project, props.file]);
  return (
    <>
      <HTMLContainer id={shape.id} data-testid="artifact-card" data-artifact-kind={kind} data-live={live ? "true" : undefined} style={{ width: props.w, height: props.h }}>
        <ShapeLabel shapeId={shape.id} kind={kind} name={readRef(shape)} width={props.w} text={name !== undefined ? `@${name}` : title} end={kind !== "component" && updates !== "" ? <UpdatesBadge shapeId={shape.id} /> : undefined} />
        {live && port !== undefined ? (
          <Scaled scale={scale} layout={layout}>
            <CanvasFrame key={props.file} shapeId={shape.id} project={project} kind={kind} file={props.file} previewPort={port} dials={props.dials} kit={kit} mode={props.mode} interactive={interactive} lazy />
          </Scaled>
        ) : (
          <Still shape={shape} title={title} />
        )}
        {live && <DropOutline shapeId={shape.id} scale={scale} />}
      </HTMLContainer>
      {kind === "motion" && <RenderRow shape={shape} />}
      <ProblemLine shapeId={shape.id} offset={props.h + (kind === "motion" ? RENDER_ROW_HEIGHT : 0)} width={props.w} />
    </>
  );
};

const makeArtifactUtil = (kind: ArtifactKind) =>
  class ArtifactShapeUtil extends BaseBoxShapeUtil<ArtifactShape> {
    static override type = kind;
    static override props = kind === "component" ? componentProps : artifactProps;

    override getDefaultProps(): ArtifactShape["props"] {
      return kind === "component" ? { ...ARTIFACT_DEFAULT_SIZE, file: "", title: "", fileName: "", tag: "" } : { ...ARTIFACT_DEFAULT_SIZE, file: "", title: "", fileName: "" };
    }

    override canEdit() {
      return false;
    }

    override component(shape: ArtifactShape) {
      noteRender(shape.id);
      return (shape.props as ArtifactShapeProps).file === "" ? <EmptyArtifact shape={shape} kind={kind} /> : <FilledArtifact shape={shape} kind={kind} />;
    }

    override getIndicatorPath(shape: ArtifactShape) {
      const path = new Path2D();
      path.rect(0, 0, shape.props.w, shape.props.h);
      return path;
    }

    override onResize(shape: ArtifactShape, info: TLResizeInfo<ArtifactShape>) {
      return resizeBox(shape, info, { minWidth: ARTIFACT_MIN.w, minHeight: ARTIFACT_MIN.h });
    }

    override onDoubleClick(shape: ArtifactShape) {
      currentSlots().openArtifact?.(this.editor, shape.id);
      return { id: shape.id, type: shape.type };
    }
  };

export const PageShapeUtil = makeArtifactUtil("page");
export const MotionShapeUtil = makeArtifactUtil("motion");
export const ComponentShapeUtil = makeArtifactUtil("component");
