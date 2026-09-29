/**
 * An imported canvas as tldraw records (spec 11): the shapes and assets the room stores,
 * in the canvas schema, with Unframed's fields where spec 02, 03, 04 and 06 put them.
 */
import type { ContentAsset, ContentShape } from "../presetRules.ts";
import type { LegacyMedia, LegacyShape } from "./canvas.ts";

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const digits = (value: number, length: number): string => {
  let text = "";
  for (let at = 0; at < length; at++, value = Math.floor(value / 62)) text = DIGITS[value % 62]! + text;
  return text;
};

/** The `n`th (0-based) fractional index key in ascending order: `a1` … `az`, then `b00` … `bzz`, then `c000` and on. */
export const legacyIndexKey = (n: number): string => {
  if (n < 61) return `a${DIGITS[n + 1]}`;
  if (n < 61 + 62 ** 2) return `b${digits(n - 61, 2)}`;
  return `c${digits(n - 61 - 62 ** 2, 3)}`;
};

/** Plain text as tldraw rich text: one paragraph per line. */
export const richTextOf = (text: string) => ({
  type: "doc",
  content: text.split("\n").map((line) => (line === "" ? { type: "paragraph" } : { type: "paragraph", content: [{ type: "text", text: line }] })),
});

export interface RecordIds {
  /** The canvas page the top-level shapes sit on. */
  readonly page: string;
  /** A tldraw shape id for a description key. */
  readonly shape: (key: string) => string;
  /** A tldraw asset id for the asset of the shape with this key. */
  readonly asset: (key: string) => string;
}

const srcOf = (media: LegacyMedia): string => {
  switch (media.kind) {
    case "file":
      return `project-file:${media.file}`;
    case "preset-file":
      return `preset-file:/${media.file}`;
    case "link":
    case "data":
      return media.url;
  }
};

const assetOf = (shape: LegacyShape, media: LegacyMedia, id: string): ContentAsset => {
  const mime = media.kind === "link" ? null : media.mime;
  return {
    id,
    typeName: "asset",
    type: shape.kind === "video" ? "video" : "image",
    props: {
      w: Math.max(1, Math.round(media.w)),
      h: Math.max(1, Math.round(media.h)),
      name: media.name,
      isAnimated: shape.kind === "video" || mime === "image/gif",
      mimeType: mime,
      src: srcOf(media),
    },
    meta: {},
  };
};

/**
 * Every record the canvas description makes. Shape ids and asset ids come from `ids`;
 * a result's sources and its recipe's sources are keys, turned into shape ids here.
 */
export const legacyRecords = (shapes: ReadonlyArray<LegacyShape>, ids: RecordIds): { shapes: ContentShape[]; assets: ContentAsset[] } => {
  const counters = new Map<string, number>();
  const nextIndex = (parent: string) => {
    const n = counters.get(parent) ?? 0;
    counters.set(parent, n + 1);
    return legacyIndexKey(n);
  };
  const known = new Set(shapes.map((shape) => shape.key));
  const shapeIds = (keys: ReadonlyArray<string>) => keys.filter((key) => known.has(key)).map(ids.shape);
  const assets: ContentAsset[] = [];
  const records = shapes.map((shape): ContentShape => {
    const parentId = shape.parent === undefined ? ids.page : ids.shape(shape.parent);
    const unframed: Record<string, unknown> = {};
    if (shape.result) {
      const sources = shapeIds(shape.result.sources);
      unframed.result = { ...shape.result, sources, recipe: { ...shape.result.recipe, sources: shapeIds(shape.result.recipe.sources) } };
    }
    if (shape.render) {
      unframed.run = { runId: shape.render.jobId, runIndex: 1, startedAt: shape.render.startedAt, durable: { params: shape.render.params } };
    }
    if (shape.recipe) unframed.recipe = shape.recipe;
    const extra = Object.keys(unframed).length > 0 ? { unframed } : {};
    const base = { id: ids.shape(shape.key), typeName: "shape" as const, x: shape.x, y: shape.y, rotation: 0, index: nextIndex(parentId), parentId, isLocked: false, opacity: 1 };
    const assetId = shape.media ? ids.asset(shape.key) : null;
    if (shape.media && assetId !== null) assets.push(assetOf(shape, shape.media, assetId));
    switch (shape.kind) {
      case "prompt":
        return {
          ...base,
          type: "text",
          props: { color: "black", size: "s", w: Math.max(1, shape.w), font: "sans", textAlign: "start", autoSize: false, scale: 1, richText: richTextOf(shape.text ?? "") },
          meta: { ref: shape.ref, sized: shape.sized === true, ...extra },
        };
      case "image":
        return {
          ...base,
          type: "image",
          props: { w: Math.max(1, shape.w), h: Math.max(1, shape.h), playing: true, url: "", assetId, crop: null, flipX: false, flipY: false, altText: "" },
          meta: { ref: shape.ref, ...extra },
        };
      case "video":
        return {
          ...base,
          type: "video",
          props: { w: Math.max(1, shape.w), h: Math.max(1, shape.h), time: 0, playing: false, autoplay: false, url: "", assetId, altText: "" },
          meta: { ref: shape.ref, ...extra },
        };
      case "group":
        return { ...base, type: "frame", props: { w: Math.max(1, shape.w), h: Math.max(1, shape.h), name: shape.ref, color: "black" }, meta: { ...extra } };
      case "page":
      case "motion": {
        const artifact = shape.artifact ?? { file: "", title: "", fileName: "" };
        return {
          ...base,
          type: shape.kind,
          props: {
            w: Math.max(1, shape.w),
            h: Math.max(1, shape.h),
            file: artifact.file,
            title: artifact.title,
            fileName: artifact.fileName,
            ...(artifact.dials ? { dials: artifact.dials } : {}),
          },
          meta: { ref: shape.ref },
        };
      }
    }
  });
  return { shapes: records, assets };
};
