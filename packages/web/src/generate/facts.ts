/**
 * What the generation rules read from the canvas: the canvas description the domain's
 * selection to request rule takes, and the facts of results and run markers on shapes.
 */
import { kindOfShapeType, parseAssetMarker, resultMetaOf, runMarkerOf } from "@unframed/contracts";
import { plainText, readRef, type CanvasShape, type Crop, type ToolbarShape } from "@unframed/domain";
import { computed, type Computed, type Editor, type TLAsset, type TLShape } from "tldraw";

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

export const isTextResult = (shape: TLShape): boolean => shape.type === "text" && resultMetaOf(shape)?.medium === "text";

/** The asset a media shape shows, when it has one. */
export const assetOf = (editor: Editor, shape: TLShape): TLAsset | undefined => {
  const assetId = field(shape.props, "assetId");
  return typeof assetId === "string" ? editor.getAsset(assetId as TLAsset["id"]) : undefined;
};

/** The project file or https link a media shape holds. */
export const mediaSource = (editor: Editor, shape: TLShape): { readonly file?: string; readonly link?: string } => {
  const src = field(assetOf(editor, shape)?.props, "src");
  const marker = typeof src === "string" ? parseAssetMarker(src) : undefined;
  if (marker?.kind === "project-file") return { file: marker.file };
  if (marker?.kind === "link") return { link: marker.url };
  return {};
};

export const pageBox = (editor: Editor, id: TLShape["id"]) => {
  const bounds = editor.getShapePageBounds(id);
  return bounds ? { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h } : undefined;
};

const describe = (editor: Editor, shape: TLShape, z: number): CanvasShape | undefined => {
  const bounds = pageBox(editor, shape.id);
  if (!bounds) return undefined;
  const kind = kindOfShapeType(shape.type);
  const parent = editor.getShape(shape.parentId as TLShape["id"]);
  const described: { -readonly [K in keyof CanvasShape]: CanvasShape[K] } = { id: shape.id, kind, bounds, z };
  if (parent?.type === "frame") described.parent = parent.id;
  const ref = readRef(shape);
  if (ref !== undefined) described.ref = ref;
  if (kind === "prompt") {
    described.text = plainText(field(shape.props, "richText"));
    if (isTextResult(shape)) described.textResult = true;
  } else if (kind === "image" || kind === "video") {
    const source = mediaSource(editor, shape);
    if (source.file !== undefined) described.file = source.file;
    if (source.link !== undefined && kind === "video") described.link = source.link;
    if (kind === "image") described.crop = (field(shape.props, "crop") as Crop | null | undefined) ?? null;
  } else if (kind === "page" || kind === "motion") {
    const file = field(shape.props, "file");
    if (typeof file === "string" && file !== "") described.file = file;
  }
  return described;
};

const descriptions = new WeakMap<Editor, Computed<CanvasShape[]>>();

/** Every shape of the page as the generation rules read it, in paint order. One computed per editor. */
export const canvasShapes = (editor: Editor): CanvasShape[] => {
  let described = descriptions.get(editor);
  if (!described) {
    described = computed("canvas description", () =>
      editor.getCurrentPageShapesSorted().flatMap((shape, z) => describe(editor, shape, z) ?? []),
    );
    descriptions.set(editor, described);
  }
  return described.get();
};

/** A shape as the toolbar reads it. */
export const toolbarShape = (editor: Editor, shape: TLShape): ToolbarShape => {
  const kind = kindOfShapeType(shape.type);
  const result = resultMetaOf(shape);
  const file = kind === "page" || kind === "motion" ? field(shape.props, "file") : undefined;
  return {
    id: shape.id,
    kind,
    ...(kind === "group" ? { ref: readRef(shape) } : {}),
    ...(typeof file === "string" && file !== "" ? { file } : {}),
    ...(result ? { result: { batchId: result.batchId, cost: result.cost, ...(result.batchExtraCost === undefined ? {} : { batchExtraCost: result.batchExtraCost }) } } : {}),
    ...(runMarkerOf(shape) ? { generating: true } : {}),
    ...(isTextResult(shape) ? { textResult: true } : {}),
  };
};

/** Every result on the page, for the batch hint. */
export const resultShapes = (editor: Editor): ToolbarShape[] =>
  editor
    .getCurrentPageShapes()
    .filter((shape) => resultMetaOf(shape) !== undefined)
    .map((shape) => toolbarShape(editor, shape));

/** The union of the page bounds of `ids`. */
export const selectionBox = (editor: Editor, ids: ReadonlyArray<TLShape["id"]>) => {
  const boxes = ids.flatMap((id) => pageBox(editor, id) ?? []);
  if (boxes.length === 0) return undefined;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
};
