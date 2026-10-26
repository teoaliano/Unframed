import type { StyleShapeProps } from "@unframed/contracts";
import { readRef, STYLE_DEFAULT_SIZE } from "@unframed/domain";
import { Palette } from "lucide-react";
import { BaseBoxShapeUtil, HTMLContainer, resizeBox, T, type RecordProps, type TLResizeInfo, type TLShape } from "tldraw";
import { noteRender } from "../../fps/renders.ts";
import { currentSlots } from "../../chrome/slots.ts";
import { artifactCardClass } from "./looks.ts";
import { nameOf } from "./labels.ts";
import { ShapeLabel } from "./ShapeLabel.tsx";

type StyleShape = TLShape<"style">;

const styleProps: RecordProps<StyleShape> = {
  w: T.nonZeroNumber,
  h: T.nonZeroNumber,
  file: T.string,
  title: T.string,
  fileName: T.string,
  swatches: T.arrayOf(T.string),
  excerpt: T.string,
};

export const STYLE_MIN = { w: 200, h: 120 };

/** The card's corner radius in page units: `rounded-xl` in artifactCardClass, the kit's --radius (10 px) plus 4. */
const CARD_RADIUS = 14;

/**
 * A style document's card: its title, the colours it names and its opening lines, all read
 * from the shape's props, which every new version writes. A render reads no file and runs
 * nothing beyond the card itself.
 */
const StyleCard = ({ shape }: { readonly shape: StyleShape }) => {
  noteRender(shape.id);
  const props = shape.props as StyleShapeProps;
  const name = nameOf(shape);
  const title = props.title.trim() || props.fileName.replace(/\.[^.]*$/, "") || "Style";
  return (
    <HTMLContainer id={shape.id} className={`${artifactCardClass} flex flex-col gap-2.5 overflow-hidden p-4 font-sans`} data-testid="style-card" style={{ width: props.w, height: props.h }}>
      <ShapeLabel shapeId={shape.id} kind="style" name={readRef(shape)} width={props.w} text={name !== undefined ? `@${name}` : "Style"} />
      <div className="flex min-w-0 items-center gap-2">
        <Palette aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-sm font-medium text-foreground" data-testid="style-title">
          {title}
        </span>
      </div>
      {props.swatches.length > 0 && (
        <div className="flex gap-1.5" data-testid="style-swatches">
          {props.swatches.map((colour) => (
            <span key={colour} className="size-6 shrink-0 rounded-md border border-foreground/15" style={{ backgroundColor: colour }} title={colour} data-swatch={colour} />
          ))}
        </div>
      )}
      {props.excerpt !== "" && (
        <p className="m-0 min-h-0 overflow-hidden text-xs leading-relaxed text-muted-foreground" data-testid="style-excerpt">
          {props.excerpt}
        </p>
      )}
      {props.file === "" && <p className="m-0 text-xs text-muted-foreground">No document yet</p>}
    </HTMLContainer>
  );
};

/** A style document (a DESIGN.md) on the canvas. Double-click opens it in the markdown window. */
export class StyleShapeUtil extends BaseBoxShapeUtil<StyleShape> {
  static override type = "style" as const;
  static override props = styleProps;

  override getDefaultProps(): StyleShape["props"] {
    return { ...STYLE_DEFAULT_SIZE, file: "", title: "", fileName: "", swatches: [], excerpt: "" };
  }

  override canEdit() {
    return false;
  }

  override component(shape: StyleShape) {
    return <StyleCard shape={shape} />;
  }

  override getIndicatorPath(shape: StyleShape) {
    const { w, h } = shape.props;
    const r = Math.min(CARD_RADIUS, w / 2, h / 2);
    // Drawn with arcTo, not Path2D.roundRect: a roundRect path added to tldraw's batched
    // indicator path stops a multi-shape selection's outlines and box from painting.
    const path = new Path2D();
    path.moveTo(r, 0);
    path.arcTo(w, 0, w, h, r);
    path.arcTo(w, h, 0, h, r);
    path.arcTo(0, h, 0, 0, r);
    path.arcTo(0, 0, w, 0, r);
    path.closePath();
    return path;
  }

  /** The rounded indicator is the outline: the square selection box would cut across the card's corners. */
  override hideSelectionBoundsFg() {
    return true;
  }

  override onResize(shape: StyleShape, info: TLResizeInfo<StyleShape>) {
    return resizeBox(shape, info, { minWidth: STYLE_MIN.w, minHeight: STYLE_MIN.h });
  }

  /** Opens the markdown window; an empty change stops tldraw from putting a new prompt where it landed. */
  override onDoubleClick(shape: StyleShape) {
    currentSlots().openArtifact?.(this.editor, shape.id);
    return { id: shape.id, type: shape.type };
  }
}
