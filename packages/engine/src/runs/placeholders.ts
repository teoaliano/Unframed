/**
 * Placeholders and their lifecycle as canvas changes: the shape a run writes before it is
 * answered, the change that fills it when its output lands, and the one that clears a
 * marker whose work did not land.
 */
import { randomUUID } from "node:crypto";
import { projectFileMarker, resultMetaOf, unframedMetaOf, type ImageRunRequest, type ResultMeta, type RunMarker } from "@unframed/contracts";
import { plainText } from "@unframed/domain";
import { toRichText, type TLRecord } from "@tldraw/tlschema";
import type { CanvasChange } from "../canvas/rooms.ts";

export const PLACEHOLDER_WIDTH = 320;

export type Shape = TLRecord & { type: string; props: Record<string, unknown>; meta: Record<string, unknown> };

export const isShape = (record: TLRecord | undefined): record is Shape => record?.typeName === "shape";

/** What landed for one output: enough to fill its placeholder, now or after an undo. */
export interface Landed {
  readonly file: string;
  readonly sidecar: string;
  readonly cost: number | null;
  readonly width: number | undefined;
  readonly height: number | undefined;
  readonly mime: string;
  readonly bytes: number;
}

/** The height of an image placeholder: from the requested `W:H` ratio or exact size, else square. */
export const placeholderHeight = (params: ImageRunRequest["params"]): number => {
  const ratio =
    params.size !== undefined
      ? /^(\d+)x(\d+)$/.exec(params.size)
      : params.aspect_ratio !== undefined
        ? /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(params.aspect_ratio)
        : null;
  const w = ratio ? Number(ratio[1]) : 0;
  const h = ratio ? Number(ratio[2]) : 0;
  return w > 0 && h > 0 ? (PLACEHOLDER_WIDTH * h) / w : PLACEHOLDER_WIDTH;
};

/** An empty image where an output will land, carrying its marker and unfilled result meta. */
export const imagePlaceholder = (input: {
  readonly at: { readonly x: number; readonly y: number };
  readonly height: number;
  readonly index: string;
  readonly parentId: string;
  readonly ref: string;
  readonly marker: RunMarker;
  readonly result: ResultMeta;
}): TLRecord =>
  ({
    id: `shape:${randomUUID()}`,
    typeName: "shape",
    type: "image",
    x: input.at.x,
    y: input.at.y,
    rotation: 0,
    index: input.index,
    parentId: input.parentId,
    isLocked: false,
    opacity: 1,
    props: { w: PLACEHOLDER_WIDTH, h: input.height, playing: true, url: "", assetId: null, crop: null, flipX: false, flipY: false, altText: "" },
    meta: { ref: input.ref, unframed: { run: input.marker, result: input.result } },
  }) as unknown as TLRecord;

/** The change that fills a placeholder: the file as its asset, the file's aspect at its width, the sidecar, no marker. */
export const fillChange = (shape: Shape, landed: Landed): CanvasChange => {
  const assetId = `asset:${randomUUID()}`;
  const width = typeof shape.props.w === "number" ? shape.props.w : PLACEHOLDER_WIDTH;
  const height = landed.width && landed.height ? (width * landed.height) / landed.width : typeof shape.props.h === "number" ? shape.props.h : width;
  const { run: _run, ...unframed } = unframedMetaOf(shape);
  const result = resultMetaOf(shape);
  const asset = {
    id: assetId,
    typeName: "asset",
    type: "image",
    props: {
      w: landed.width ?? Math.round(width),
      h: landed.height ?? Math.round(height),
      name: landed.file,
      isAnimated: landed.mime === "image/gif",
      mimeType: landed.mime,
      src: projectFileMarker(landed.file),
      ...(landed.bytes > 0 ? { fileSize: landed.bytes } : {}),
    },
    meta: {},
  } as unknown as TLRecord;
  const filled = {
    ...shape,
    props: { ...shape.props, assetId, h: height, crop: null },
    meta: { ...shape.meta, unframed: { ...unframed, ...(result ? { result: { ...result, sidecar: landed.sidecar, cost: landed.cost } } : {}) } },
  } as unknown as TLRecord;
  return { put: [asset, filled], remove: [] };
};

/** What landed for a text run (spec 05): the answer and its sidecar, `null` when none could be written. */
export interface LandedText {
  readonly kind: "text";
  readonly text: string;
  readonly sidecar: string | null;
  readonly cost: number | null;
}

/** A text result's placeholder: an empty prompt (spec 02's text shape) carrying its marker and unfilled result meta. */
export const textPlaceholder = (input: {
  readonly at: { readonly x: number; readonly y: number };
  readonly index: string;
  readonly parentId: string;
  readonly ref: string;
  readonly marker: RunMarker;
  readonly result: ResultMeta;
}): TLRecord =>
  ({
    id: `shape:${randomUUID()}`,
    typeName: "shape",
    type: "text",
    x: input.at.x,
    y: input.at.y,
    rotation: 0,
    index: input.index,
    parentId: input.parentId,
    isLocked: false,
    opacity: 1,
    props: { color: "black", size: "s", w: PLACEHOLDER_WIDTH, font: "sans", textAlign: "start", autoSize: false, scale: 1, richText: toRichText("") },
    meta: { ref: input.ref, unframed: { run: input.marker, result: input.result } },
  }) as unknown as TLRecord;

/** The change that fills a text placeholder: the answer as its text, the sidecar and cost, no marker. */
const textFillChange = (shape: Shape, landed: LandedText): CanvasChange => {
  const { run: _run, ...unframed } = unframedMetaOf(shape);
  const result = resultMetaOf(shape);
  const filled = {
    ...shape,
    props: { ...shape.props, richText: toRichText(landed.text) },
    meta: { ...shape.meta, unframed: { ...unframed, ...(result ? { result: { ...result, sidecar: landed.sidecar, cost: landed.cost } } : {}) } },
  } as unknown as TLRecord;
  return { put: [filled], remove: [] };
};

/** The change that fills a placeholder with whatever landed for it. */
export const fillFor = (shape: Shape, landed: Landed | LandedText): CanvasChange =>
  "kind" in landed ? textFillChange(shape, landed) : fillChange(shape, landed);

/** The change that settles a marker whose work did not land: the marker goes, and an empty shape goes too. */
export const clearChange = (shape: Shape): CanvasChange => {
  if (shape.type === "text") {
    if (plainText(shape.props.richText).trim() === "") return { put: [], remove: [shape.id] };
    const { run: _run, ...unframed } = unframedMetaOf(shape);
    return { put: [{ ...shape, meta: { ...shape.meta, unframed } } as unknown as TLRecord], remove: [] };
  }
  if (shape.props.assetId === null || shape.props.assetId === undefined) return { put: [], remove: [shape.id] };
  const { run: _run, ...unframed } = unframedMetaOf(shape);
  return { put: [{ ...shape, meta: { ...shape.meta, unframed } } as unknown as TLRecord], remove: [] };
};
