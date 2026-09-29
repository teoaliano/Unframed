import type { ArtifactShapeProps } from "@unframed/contracts";
import { artifactTitle } from "@unframed/domain";
import { AppWindow, Clapperboard } from "lucide-react";
import { useRef } from "react";
import { BaseBoxShapeUtil, getPointerInfo, HTMLContainer, resizeBox, T, useEditor, useValue, type RecordProps, type TLResizeInfo, type TLShape } from "tldraw";
import { ArtifactFrame } from "../../artifacts/ArtifactFrame.tsx";
import { ProblemLine, RenderRow } from "../../artifacts/RenderRow.tsx";
import { snapshotsOf, snapshotUrl } from "../../artifacts/snapshots.ts";
import { isInteractive, isLive, previewPort } from "../../artifacts/state.ts";
import { currentSlots, useSlots } from "../../chrome/slots.ts";
import { useCanvasProject } from "../../context.ts";
import { ShapeLabel } from "./ShapeLabel.tsx";
import { noteRender } from "../../fps/renders.ts";

export const ARTIFACT_DEFAULT_SIZE = { w: 480, h: 320 };
export const ARTIFACT_MIN = { w: 180, h: 96 };
export const ARTIFACT_MAX = { w: 900, h: 900 };

type ArtifactShape = TLShape<"page"> | TLShape<"motion">;
type Kind = "page" | "motion";

const artifactProps: RecordProps<ArtifactShape> = {
  w: T.nonZeroNumber,
  h: T.nonZeroNumber,
  file: T.string,
  title: T.string,
  fileName: T.string,
  dials: T.dict(T.string, T.jsonValue).optional(),
};

/** The row under a motion (Render) is this tall; the status line goes below it. */
const RENDER_ROW_HEIGHT = 34;

/** An empty artifact: its frame, its kind tab and one Agent button. */
const EmptyArtifact = ({ shape, kind }: { readonly shape: ArtifactShape; readonly kind: Kind }) => {
  noteRender(shape.id);
  const { artifactEmptyState: EmptyState } = useSlots();
  const Icon = kind === "page" ? AppWindow : Clapperboard;
  const props = shape.props as ArtifactShapeProps;
  return (
    <HTMLContainer id={shape.id} className="unframed-artifact" data-artifact-kind={kind} style={{ width: props.w, height: props.h }}>
      <ShapeLabel shapeId={shape.id} kind={kind}>
        {kind}
      </ShapeLabel>
      <div className="unframed-artifact__empty">
        <Icon size={28} strokeWidth={1.5} aria-label={kind === "page" ? "Page" : "Motion"} />
        {EmptyState && <EmptyState shapeId={shape.id} />}
      </div>
    </HTMLContainer>
  );
};

/**
 * What a filled artifact that is not live shows: the newest snapshot of its file (the last
 * one it showed while none exists yet), else a card with its title that asks to be selected.
 */
const Still = ({ shape, title }: { readonly shape: ArtifactShape; readonly title: string }) => {
  const project = useCanvasProject();
  const file = (shape.props as ArtifactShapeProps).file;
  const current = useValue("artifact snapshot", () => {
    const snapshot = snapshotsOf(project).get().get(file);
    return snapshot === undefined ? undefined : snapshotUrl(project, snapshot);
  }, [project, file]);
  const shown = useRef<string | undefined>(undefined);
  if (current !== undefined) shown.current = current;
  const src = current ?? shown.current;
  if (src !== undefined) return <img className="unframed-artifact__snapshot" src={src} alt="" draggable={false} />;
  return (
    <div className="unframed-artifact__hint">
      {title !== "" && <span className="unframed-artifact__hint-title">{title}</span>}
      <span>Select to preview</span>
    </div>
  );
};

/** A filled artifact: no card, the title above its corner, and its frame while live, else its still. */
const FilledArtifact = ({ shape, kind }: { readonly shape: ArtifactShape; readonly kind: Kind }) => {
  noteRender(shape.id);
  const editor = useEditor();
  const project = useCanvasProject();
  const props = shape.props as ArtifactShapeProps;
  const live = useValue("artifact live", () => isLive(editor, shape.id), [editor, shape.id]);
  const interactive = useValue("artifact interactive", () => live && isInteractive(editor, shape.id), [editor, shape.id, live]);
  const port = useValue("preview port", () => previewPort.get(), []);
  const title = artifactTitle(props);
  return (
    <>
      <HTMLContainer id={shape.id} className="unframed-artifact unframed-artifact--filled" data-artifact-kind={kind} data-live={live ? "true" : undefined} style={{ width: props.w, height: props.h }}>
        {title !== "" && (
          <ShapeLabel
            shapeId={shape.id}
            kind={kind}
            onPointerDown={(event) => {
              // The title is the handle: a selected frame takes every press inside the shape.
              const current = editor.getShape(shape.id);
              if (current) editor.dispatch({ type: "pointer", name: "pointer_down", target: "shape", shape: current, ...getPointerInfo(editor, event) });
            }}
          >
            {title}
          </ShapeLabel>
        )}
        {live && port !== undefined ? (
          <ArtifactFrame key={props.file} project={project} kind={kind} file={props.file} previewPort={port} dials={props.dials} interactive={interactive} lazy />
        ) : (
          <Still shape={shape} title={title} />
        )}
      </HTMLContainer>
      {kind === "motion" && <RenderRow shape={shape} />}
      <ProblemLine shapeId={shape.id} offset={props.h + (kind === "motion" ? RENDER_ROW_HEIGHT : 0)} width={props.w} />
    </>
  );
};

/** A page or a motion: empty, it asks for the agent; filled, it shows its content. */
const makeArtifactUtil = (kind: Kind) =>
  class ArtifactShapeUtil extends BaseBoxShapeUtil<ArtifactShape> {
    static override type = kind;
    static override props = artifactProps;

    override getDefaultProps(): ArtifactShape["props"] {
      return { ...ARTIFACT_DEFAULT_SIZE, file: "", title: "", fileName: "" };
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
      return resizeBox(shape, info, { minWidth: ARTIFACT_MIN.w, minHeight: ARTIFACT_MIN.h, maxWidth: ARTIFACT_MAX.w, maxHeight: ARTIFACT_MAX.h });
    }

    /** Double-click opens the editor; it never enters tldraw's editing state. */
    override onDoubleClick(shape: ArtifactShape) {
      currentSlots().openArtifact?.(this.editor, shape.id);
      return undefined;
    }
  };

export const PageShapeUtil = makeArtifactUtil("page");
export const MotionShapeUtil = makeArtifactUtil("motion");
