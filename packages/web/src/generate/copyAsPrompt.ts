import { placeResults } from "@unframed/domain";
import { createShapeId, type Editor, type TLShape, type TLTextShape } from "tldraw";
import { pageBox } from "./facts.ts";

/**
 * Copy as prompt (spec 05): a plain prompt with a text result's text, placed beside it by
 * result placement. It carries no result meta, so its own `@` tokens resolve like any
 * prompt's; the text result keeps saying what the model produced.
 */
export const copyAsPrompt = (editor: Editor, shape: TLShape): void => {
  if (shape.type !== "text") return;
  const anchor = pageBox(editor, shape.id);
  if (!anchor) return;
  const obstacles = editor.getCurrentPageShapes().flatMap((each) => pageBox(editor, each.id) ?? []);
  const [at] = placeResults(anchor, [{ w: anchor.w, h: anchor.h }], obstacles);
  const { props } = shape as TLTextShape;
  const sized = (shape.meta as { sized?: unknown }).sized === true;
  editor.createShape<TLTextShape>({
    id: createShapeId(),
    type: "text",
    x: at!.x,
    y: at!.y,
    props: { richText: props.richText, w: props.w, size: props.size, font: props.font, textAlign: props.textAlign, color: props.color, scale: props.scale, autoSize: false },
    meta: sized ? { sized: true } : {},
  });
};
