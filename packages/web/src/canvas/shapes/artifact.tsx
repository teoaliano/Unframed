import type { ArtifactShapeProps } from "@unframed/contracts";
import { AppWindow, Clapperboard } from "lucide-react";
import { BaseBoxShapeUtil, HTMLContainer, T, type RecordProps, type TLResizeInfo, type TLShape } from "tldraw";
import { useSlots } from "../../chrome/slots.ts";
import { ShapeLabel } from "./ShapeLabel.tsx";

export const ARTIFACT_DEFAULT_SIZE = { w: 480, h: 320 };
export const ARTIFACT_MIN = { w: 180, h: 96 };
export const ARTIFACT_MAX = { w: 900, h: 900 };

type ArtifactShape = TLShape<"page"> | TLShape<"motion">;

const artifactProps: RecordProps<ArtifactShape> = {
  w: T.nonZeroNumber,
  h: T.nonZeroNumber,
  file: T.string,
  title: T.string,
  fileName: T.string,
  dials: T.dict(T.string, T.jsonValue).optional(),
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const ArtifactCard = ({ shape, kind }: { readonly shape: ArtifactShape; readonly kind: "page" | "motion" }) => {
  const { artifactEmptyState: EmptyState } = useSlots();
  const Icon = kind === "page" ? AppWindow : Clapperboard;
  const props = shape.props as ArtifactShapeProps;
  return (
    <HTMLContainer id={shape.id} className="unframed-artifact" data-artifact-kind={kind} style={{ width: props.w, height: props.h }}>
      {props.title !== "" && (
        <ShapeLabel shapeId={shape.id} kind={kind}>
          {props.title}
        </ShapeLabel>
      )}
      {props.file === "" && (
        <div className="unframed-artifact__empty">
          <Icon size={28} strokeWidth={1.5} aria-label={kind === "page" ? "Page" : "Motion"} />
          {EmptyState && <EmptyState shapeId={shape.id} />}
        </div>
      )}
    </HTMLContainer>
  );
};

/**
 * A page or a motion. This spec gives them their empty card, file and title; spec 09 renders
 * their content and opens the editor.
 */
const makeArtifactUtil = (kind: "page" | "motion") =>
  class ArtifactShapeUtil extends BaseBoxShapeUtil<ArtifactShape> {
    static override type = kind;
    static override props = artifactProps;

    override getDefaultProps(): ArtifactShape["props"] {
      return { ...ARTIFACT_DEFAULT_SIZE, file: "", title: "", fileName: "" };
    }

    override component(shape: ArtifactShape) {
      return <ArtifactCard shape={shape} kind={kind} />;
    }

    override getIndicatorPath(shape: ArtifactShape) {
      const path = new Path2D();
      path.rect(0, 0, shape.props.w, shape.props.h);
      return path;
    }

    override onResize(shape: ArtifactShape, info: TLResizeInfo<ArtifactShape>) {
      const resized = super.onResize(shape, info);
      const w = clamp(resized.props?.w ?? shape.props.w, ARTIFACT_MIN.w, ARTIFACT_MAX.w);
      const h = clamp(resized.props?.h ?? shape.props.h, ARTIFACT_MIN.h, ARTIFACT_MAX.h);
      const left = info.handle.includes("left");
      const top = info.handle.includes("top");
      return {
        ...resized,
        x: left ? info.initialShape.x + info.initialShape.props.w - w : info.initialShape.x,
        y: top ? info.initialShape.y + info.initialShape.props.h - h : info.initialShape.y,
        props: { ...resized.props, w, h },
      };
    }
  };

export const PageShapeUtil = makeArtifactUtil("page");
export const MotionShapeUtil = makeArtifactUtil("motion");
