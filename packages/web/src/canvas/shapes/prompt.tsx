import { resultMetaOf, runMarkerOf } from "@unframed/contracts";
import { formatCost, plainText } from "@unframed/domain";
import {
  createComputedCache,
  getDisplayValues,
  renderHtmlFromRichTextForMeasurement,
  RichTextLabel,
  TextShapeUtil,
  toRichText,
  useColorMode,
  useEditor,
  useValue,
  Vec,
  type Editor,
  type TextShapeUtilDisplayValues,
  type TLResizeInfo,
  type TLShapePartial,
  type TLTextShape,
} from "tldraw";
import { Spinner } from "~/components/ui/spinner";
import { ShapeLabel } from "./ShapeLabel.tsx";
import { noteRender } from "../../fps/renders.ts";

export const PROMPT_HUG_WIDTH = 320;
export const PROMPT_MIN_WIDTH = 40;
export const PROMPT_MIN_HEIGHT = 28;
export const PROMPT_HINT = "Add text…";
/** What a text result's placeholder says while its run is in flight (spec 05). */
export const PROMPT_RUNNING = "Running…";

const HINT_TEXT = toRichText(PROMPT_HINT);

type PromptMeta = { ref?: string; sized?: boolean };
const metaOf = (shape: TLTextShape) => shape.meta as PromptMeta;

export const isEmptyPrompt = (shape: TLTextShape): boolean => plainText(shape.props.richText).trim() === "";

const measure = (editor: Editor, shape: TLTextShape, dv: TextShapeUtilDisplayValues, maxWidth: number | null) =>
  editor.textMeasure.measureHtml(renderHtmlFromRichTextForMeasurement(editor, isEmptyPrompt(shape) ? HINT_TEXT : shape.props.richText), {
    lineHeight: dv.lineHeight,
    fontWeight: dv.fontWeight,
    fontStyle: dv.fontStyle,
    padding: "0px",
    fontFamily: dv.fontFamily,
    fontSize: dv.fontSize,
    maxWidth,
  });

/**
 * A prompt's box, in canvas units, whatever the zoom. Until it is sized by hand it hugs its
 * text (or its hint, when empty) up to 320 px of content, then wraps and grows downward;
 * widths round up so the last word never wraps. Once sized it keeps its width and wraps
 * inside it.
 */
const promptBox = (editor: Editor, shape: TLTextShape, dv: TextShapeUtilDisplayValues) => {
  if (metaOf(shape).sized) {
    const width = Math.max(PROMPT_MIN_WIDTH, shape.props.w);
    return { width, height: Math.max(PROMPT_MIN_HEIGHT, measure(editor, shape, dv, width).h) };
  }
  const natural = measure(editor, shape, dv, null);
  const width = Math.ceil(natural.w) + 1;
  if (width <= PROMPT_HUG_WIDTH) {
    return { width: Math.max(PROMPT_MIN_WIDTH, width), height: Math.max(PROMPT_MIN_HEIGHT, natural.h) };
  }
  return { width: PROMPT_HUG_WIDTH, height: Math.max(PROMPT_MIN_HEIGHT, measure(editor, shape, dv, PROMPT_HUG_WIDTH).h) };
};

const boxCache = createComputedCache(
  "prompt box",
  (editor: Editor, shape: TLTextShape) => {
    editor.fonts.trackFontsForShape(shape);
    const util = editor.getShapeUtil(shape) as PromptShapeUtil;
    return promptBox(editor, shape, getDisplayValues(util, shape));
  },
  { areRecordsEqual: (a, b) => a.props === b.props && metaOf(a).sized === metaOf(b).sized },
);

/**
 * The prompt: tldraw's text shape, bare on the canvas, with its `@id` above it. It is kept
 * when emptied, says "Add text…" while empty, and is never scaled by a resize: dragging an
 * edge or corner changes its width and pins that size.
 */
export class PromptShapeUtil extends TextShapeUtil {
  static override type = "text" as const;

  override getDefaultProps(): TLTextShape["props"] {
    return { ...super.getDefaultProps(), font: "sans", size: "s", textAlign: "start", autoSize: false, w: PROMPT_HUG_WIDTH };
  }

  override getMinDimensions(shape: TLTextShape) {
    return boxCache.get(this.editor, shape.id)!;
  }

  override component(shape: TLTextShape) {
    noteRender(shape.id);
    return <PromptShape shape={shape} util={this} />;
  }

  override onBeforeUpdate() {
    return undefined;
  }

  override onEditEnd() {}

  override onResize(shape: TLTextShape, info: TLResizeInfo<TLTextShape>) {
    const { newPoint, initialBounds, initialShape, scaleX, handle } = info;
    const pinned = { ...shape.meta, sized: true };
    const partial: TLShapePartial<TLTextShape> =
      handle === "top" || handle === "bottom"
        ? { id: shape.id, type: shape.type, meta: pinned }
        : (() => {
            const width = Math.max(PROMPT_MIN_WIDTH, Math.abs(initialBounds.width * scaleX) / initialShape.props.scale);
            const { x, y } = scaleX < 0 ? Vec.Sub(newPoint, Vec.FromAngle(shape.rotation).mul(width)) : newPoint;
            return { id: shape.id, type: shape.type, x, y, props: { w: width, autoSize: false }, meta: pinned };
          })();
    // tldraw types its own text resize narrowly; a prompt also writes meta.sized.
    return partial as ReturnType<TextShapeUtil["onResize"]>;
  }

  override onDoubleClickEdge(shape: TLTextShape): TLShapePartial<TLTextShape> {
    return { id: shape.id, type: shape.type, meta: { ...shape.meta, sized: false } };
  }
}

const PromptShape = ({ shape, util }: { readonly shape: TLTextShape; readonly util: PromptShapeUtil }) => {
  noteRender(shape.id);
  const editor = useEditor();
  const colorMode = useColorMode();
  const dv = getDisplayValues(util, shape, colorMode);
  const { width, height } = util.getMinDimensions(shape);
  const isSelected = useValue("prompt selected", () => editor.getOnlySelectedShapeId() === shape.id, [editor, shape.id]);
  const empty = isEmptyPrompt(shape);
  const { ref } = metaOf(shape);
  // A text result (spec 05) carries its cost on its line; its placeholder says the run is in flight.
  const result = resultMetaOf(shape);
  const running = empty && runMarkerOf(shape) !== undefined;
  const cost = result?.medium === "text" && result.cost !== null ? `${formatCost(result.cost)} · ` : "";
  const hintStyle = { fontFamily: dv.fontFamily, fontSize: dv.fontSize, lineHeight: dv.lineHeight, width, height };
  return (
    <div className="relative" data-testid="prompt" style={{ width, height, transform: `scale(${shape.props.scale})`, transformOrigin: "top left" }}>
      <ShapeLabel shapeId={shape.id} kind="prompt" name={ref} width={width} text={`${cost}@${ref ?? ""}`} />
      {running ? (
        <div className="pointer-events-none absolute top-0 left-0 flex items-center gap-1.5 whitespace-nowrap text-muted-foreground" data-testid="prompt-hint" role="status" style={hintStyle}>
          <Spinner size="sm" aria-hidden />
          <span>{PROMPT_RUNNING}</span>
        </div>
      ) : (
        empty && (
          <div className="pointer-events-none absolute top-0 left-0 whitespace-pre-wrap text-muted-foreground" data-testid="prompt-hint" style={hintStyle}>
            {PROMPT_HINT}
          </div>
        )
      )}
      <RichTextLabel
        shapeId={shape.id}
        classNamePrefix="tl-text-shape"
        type="text"
        fontFamily={dv.fontFamily}
        fontSize={dv.fontSize}
        lineHeight={dv.lineHeight}
        textAlign={shape.props.textAlign === "middle" ? "center" : shape.props.textAlign}
        verticalAlign="start"
        richText={shape.props.richText}
        labelColor={dv.color}
        isSelected={isSelected}
        textWidth={width}
        textHeight={height}
        showTextOutline={false}
        wrap
      />
    </div>
  );
};
